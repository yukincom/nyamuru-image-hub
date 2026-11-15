import type { QwenAdoption, QwenGenerationPlan, QwenJob } from '../qwenGeneration.ts';

/** Convert a PNG data URL returned by the bridge into a File object. */
export function dataUrlToPngFile(dataUrl: string, fileName: string): File {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], fileName, { type: 'image/png' });
}

/** Extract File objects for the chosen candidate indices from a job result. */
export function candidateFilesFromJob(job: QwenJob, indices: number[]): File[] {
  return indices.map((index) => {
    const image = job.candidates?.find((candidate) => candidate.index === index)?.image;
    if (!image) throw new Error('採用する候補を読み込めません');
    return dataUrlToPngFile(image, `qwen_${job.jobId}_${index}.png`);
  });
}

/** Fit/clip a generated PNG to target.outputFrame when needed, preserving aspect ratio for workflow outputs. */
export async function prepareGeneratedInsertionFile(
  file: File,
  target: QwenGenerationPlan,
  preserveAspect = false,
): Promise<File> {
  if (!target.outputFrame) return file;
  const bitmap = await createImageBitmap(file);
  try {
    if (target.threeImages && preserveAspect && bitmap.width === target.width && bitmap.height === target.height) {
      return file; // Preserve the print DPI and pixels of the adopted PNG.
    }
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('生成画像を配置できません');
    const cut = target.humanPose?.cutFrame;
    if (cut) {
      context.beginPath();
      cut.points.forEach(([x, y], index) => {
        const px = (x - cut.bounds.x) / cut.bounds.w * canvas.width;
        const py = (y - cut.bounds.y) / cut.bounds.h * canvas.height;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      });
      context.closePath();
      context.clip();
    }
    if (target.scope) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (preserveAspect) {
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    } else {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('生成画像を保存できません'))), 'image/png'));
    return new File([blob], file.name, { type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/** Auto-adopt candidate(s), prepare files, insert them into the document, and clean up unchosen candidates. */
export async function adoptAndInsertCandidates(options: {
  job: QwenJob;
  indices: number[];
  target: QwenGenerationPlan;
  selectCandidate: (job: QwenJob, indices: number[], adopted?: boolean) => Promise<QwenJob>;
  insertFiles: (files: File[], adoption: QwenAdoption) => Promise<void>;
}): Promise<QwenJob> {
  const { job, indices, target, selectCandidate, insertFiles } = options;
  const result = job.selectedCandidates ? job : await selectCandidate(job, indices);
  const rawFiles = candidateFilesFromJob(result, indices);
  const prepared: File[] = [];
  for (const item of rawFiles) prepared.push(await prepareGeneratedInsertionFile(item, target, true));
  await insertFiles(prepared, { jobId: job.jobId, indices });
  return await selectCandidate(result, indices, true);
}
