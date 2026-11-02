import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export default function NewLayoutSourceImage({ file, alt, style }: {
  file: File;
  alt: string;
  style?: JSX.CSSProperties;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Recreated effects also recreate their URL, including during development refresh.
  return preview?.file === file ? <img src={preview.url} alt={alt} style={style} /> : null;
}
