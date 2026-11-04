//! A PDF of page images, for reading a name back or sharing it.
//!
//! The pages are drawn by the app (it has the fonts for the dialogue) and
//! come here as JPEG; each becomes one PDF page of the given size. A
//! right-bound book opens right to left in viewers that honour it, a
//! 縦スクロール strip as one column of pieces.

const POINTS_PER_MM: f64 = 72.0 / 25.4;

pub struct PdfImagePage {
    pub width_mm: f64,
    pub height_mm: f64,
    pub width_px: u32,
    pub height_px: u32,
    /// Baseline JPEG, RGB.
    pub jpeg: Vec<u8>,
}

/// How the pages are shown in a viewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfLayout {
    /// 右綴じ: spreads, read right to left.
    RightToLeft,
    /// 左綴じ: spreads, read left to right.
    LeftToRight,
    /// 縦スクロール: one page under the other.
    Scroll,
}

/// Text string in UTF-16BE with a byte order mark, as PDF wants for non-ASCII.
fn text_string(text: &str) -> String {
    let mut hex = String::from("<FEFF");
    for unit in text.encode_utf16() {
        hex.push_str(&format!("{unit:04X}"));
    }
    hex.push('>');
    hex
}

pub fn image_pdf(title: &str, pages: &[PdfImagePage], layout: PdfLayout) -> Vec<u8> {
    let mut out: Vec<u8> = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets: Vec<usize> = Vec::new();
    // Objects: 1 catalog, 2 page tree, 3 info, then page, content, image per page.
    let page_id = |index: usize| 4 + index * 3;
    let object = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };
    let preferences = match layout {
        PdfLayout::RightToLeft => " /ViewerPreferences << /Direction /R2L >> /PageLayout /TwoPageRight",
        PdfLayout::LeftToRight => " /PageLayout /TwoPageRight",
        PdfLayout::Scroll => " /PageLayout /OneColumn",
    };
    object(
        &mut out,
        &mut offsets,
        format!("<< /Type /Catalog /Pages 2 0 R{preferences} >>").as_bytes(),
    );
    let kids: Vec<String> = (0..pages.len())
        .map(|index| format!("{} 0 R", page_id(index)))
        .collect();
    object(
        &mut out,
        &mut offsets,
        format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), pages.len()).as_bytes(),
    );
    object(
        &mut out,
        &mut offsets,
        format!("<< /Title {} /Producer (Name Studio) >>", text_string(title)).as_bytes(),
    );
    for (index, page) in pages.iter().enumerate() {
        let (width, height) = (page.width_mm * POINTS_PER_MM, page.height_mm * POINTS_PER_MM);
        let id = page_id(index);
        object(
            &mut out,
            &mut offsets,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width:.2} {height:.2}] /Contents {} 0 R \
                 /Resources << /XObject << /Im0 {} 0 R >> >> >>",
                id + 1,
                id + 2
            )
            .as_bytes(),
        );
        let content = format!("q {width:.2} 0 0 {height:.2} 0 0 cm /Im0 Do Q");
        object(
            &mut out,
            &mut offsets,
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).as_bytes(),
        );
        let mut image = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB \
             /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            page.width_px,
            page.height_px,
            page.jpeg.len()
        )
        .into_bytes();
        image.extend_from_slice(&page.jpeg);
        image.extend_from_slice(b"\nendstream");
        object(&mut out, &mut offsets, &image);
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for offset in &offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R /Info 3 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            offsets.len() + 1
        )
        .as_bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_page_per_image_with_a_valid_cross_reference() {
        let page = |jpeg: &[u8]| PdfImagePage {
            width_mm: 257.0,
            height_mm: 364.0,
            width_px: 2,
            height_px: 3,
            jpeg: jpeg.to_vec(),
        };
        let pdf = image_pdf(
            "第1話",
            &[page(b"\xFF\xD8one\xFF\xD9"), page(b"\xFF\xD8two\xFF\xD9")],
            PdfLayout::RightToLeft,
        );
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.7"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/Direction /R2L"));
        assert!(text.contains("<FEFF7B2C00318A71>"));
        // 257 mm = 728.50 pt.
        assert!(text.contains("/MediaBox [0 0 728.50 1031.81]"));
        // Every cross-reference entry points at its object (offsets are in bytes).
        let tail = |marker: &str| {
            let at = pdf
                .windows(marker.len())
                .rposition(|window| window == marker.as_bytes())
                .unwrap();
            String::from_utf8(pdf[at + marker.len()..].to_vec()).unwrap()
        };
        let start: usize = tail("startxref\n").lines().next().unwrap().parse().unwrap();
        let table = String::from_utf8(pdf[start..].to_vec()).unwrap();
        let entries: Vec<&str> = table.lines().skip(3).take(9).collect();
        for (number, entry) in entries.iter().enumerate() {
            let offset: usize = entry[..10].parse().unwrap();
            assert!(
                pdf[offset..].starts_with(format!("{} 0 obj", number + 1).as_bytes()),
                "object {}",
                number + 1
            );
        }
    }

    #[test]
    fn lays_out_a_strip_as_one_column_and_a_left_bound_book_as_spreads() {
        let page = PdfImagePage {
            width_mm: 120.0,
            height_mm: 240.0,
            width_px: 1,
            height_px: 2,
            jpeg: b"\xFF\xD8\xFF\xD9".to_vec(),
        };
        let strip =
            String::from_utf8_lossy(&image_pdf("t", std::slice::from_ref(&page), PdfLayout::Scroll)).into_owned();
        assert!(strip.contains("/PageLayout /OneColumn"));
        assert!(!strip.contains("/R2L"));
        let book = String::from_utf8_lossy(&image_pdf("t", &[page], PdfLayout::LeftToRight)).into_owned();
        assert!(book.contains("/PageLayout /TwoPageRight"));
        assert!(!book.contains("/R2L"));
    }
}
