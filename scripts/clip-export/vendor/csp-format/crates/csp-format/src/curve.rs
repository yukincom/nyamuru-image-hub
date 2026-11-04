//! The curves CSP draws through control points (tone curves, gradient
//! stops): a clamped uniform quadratic B-spline with the points as its
//! control polygon. Measured against CSP exports to within one level
//! (`docs/validation/V6b-generated-layers.md`).

/// A curve `y = f(x)` through control points, sampled finely so it can be
/// evaluated at any `x`.
#[derive(Debug, Clone, PartialEq)]
pub struct Spline {
    xs: Vec<f64>,
    ys: Vec<f64>,
}

/// Samples per quadratic span.
const STEPS: usize = 256;

impl Spline {
    /// The spline through `points` (x ascending). One point gives a
    /// constant, two a straight line; an empty list the identity.
    pub fn new(points: &[(f64, f64)]) -> Self {
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        let mut push = |(x, y): (f64, f64)| {
            xs.push(x);
            ys.push(y);
        };
        match points.len() {
            0 => [(0.0, 0.0), (1.0, 1.0)].into_iter().for_each(&mut push),
            1 | 2 => points.iter().copied().for_each(&mut push),
            n => {
                // Span j is the quadratic Bézier (start, P[j+1], end) with
                // start and end at the midpoints of the control polygon,
                // except at the clamped ends.
                let mid = |a: (f64, f64), b: (f64, f64)| ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
                for j in 0..n - 2 {
                    let start = if j == 0 { points[0] } else { mid(points[j], points[j + 1]) };
                    let control = points[j + 1];
                    let end = if j == n - 3 { points[n - 1] } else { mid(points[j + 1], points[j + 2]) };
                    for step in usize::from(j > 0)..=STEPS {
                        let t = step as f64 / STEPS as f64;
                        let (a, b, c) = ((1.0 - t) * (1.0 - t), 2.0 * t * (1.0 - t), t * t);
                        push((a * start.0 + b * control.0 + c * end.0, a * start.1 + b * control.1 + c * end.1));
                    }
                }
            }
        }
        Spline { xs, ys }
    }

    /// `f(x)`; outside the points the end values continue.
    pub fn at(&self, x: f64) -> f64 {
        let (xs, ys) = (&self.xs, &self.ys);
        if x <= xs[0] {
            return ys[0];
        }
        let i = xs.partition_point(|&v| v < x);
        if i >= xs.len() {
            return ys[ys.len() - 1];
        }
        let (x0, x1) = (xs[i - 1], xs[i]);
        if x1 <= x0 { ys[i] } else { ys[i - 1] + (ys[i] - ys[i - 1]) * (x - x0) / (x1 - x0) }
    }

    /// A 256-entry table of `f` on 0..=255 (both axes scaled by 255).
    pub fn table(&self) -> [f32; 256] {
        std::array::from_fn(|v| (self.at(v as f64 / 255.0) * 255.0).clamp(0.0, 255.0) as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_points_are_a_line_and_ends_are_kept() {
        let line = Spline::new(&[(0.0, 0.2), (1.0, 0.8)]);
        assert!((line.at(0.5) - 0.5).abs() < 1e-9);
        assert_eq!(line.at(-1.0), 0.2);
        assert_eq!(line.at(2.0), 0.8);
    }

    #[test]
    fn three_points_are_one_quadratic() {
        // Bézier (0,0) (0.5,1) (1,0): at x = 0.5 (t = 0.5) y = 0.5.
        let bump = Spline::new(&[(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)]);
        assert!((bump.at(0.5) - 0.5).abs() < 1e-3);
    }

    #[test]
    fn default_gradient_curve_is_symmetric() {
        let s = Spline::new(&[(0.0, 0.0), (0.25, 0.1), (0.75, 0.9), (1.0, 1.0)]);
        assert!((s.at(0.5) - 0.5).abs() < 1e-3);
        // Measured in CSP: about 0.178 a quarter of the way.
        assert!((s.at(0.25) - 0.178).abs() < 0.005, "{}", s.at(0.25));
    }
}
