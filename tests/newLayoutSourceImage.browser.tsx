import { render } from 'preact';
import NewLayoutSourceImage from '../src/components/NewLayoutSourceImage';

// 見込み: 元Fileから作るプレビューは、表示を破棄して再作成してもdecodeできる。
// 合格: 元寸法と色を持つ2ページの切替・再作成に成功。実component・実blobを使用し、推論や作品保存は行わない。
const root = document.querySelector('#fixture')!;
const result = document.querySelector('#result')!;
const waitForImage = async (width: number) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const image = root.querySelector('img');
    if (image?.complete && image.naturalWidth === width) return image;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`幅${width}pxの画像を表示できません`);
};
const createFile = async (width: number, color: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = 80;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color; context.fillRect(0, 0, width, 80);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
  return new File([blob], `${color}.png`, { type: 'image/png' });
};
try {
  const first = await createFile(120, 'red'), second = await createFile(180, 'blue');
  render(<NewLayoutSourceImage file={first} alt="ネーム1" />, root);
  const firstUrl = (await waitForImage(120)).src;
  render(<NewLayoutSourceImage file={second} alt="ネーム2" />, root);
  const secondUrl = (await waitForImage(180)).src;
  if (firstUrl === secondUrl) throw Error('切替後も同じURLです');
  render(null, root);
  render(<NewLayoutSourceImage file={first} alt="ネーム1を再表示" />, root);
  const recreated = await waitForImage(120);
  if (recreated.src === firstUrl) throw Error('破棄済みのURLを再利用しています');
  result.textContent = 'PASS — 初回表示・ページ切替・破棄後の再表示。元の画像寸法と新しいURLを確認。';
} catch (error) {
  result.textContent = `FAIL — ${String(error)}`;
}
