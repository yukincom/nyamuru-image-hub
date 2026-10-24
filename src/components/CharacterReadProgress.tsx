import { useEffect, useState } from 'preact/hooks';
import { LoaderCircle } from 'lucide-preact';

export interface CharacterReadProgressState { completed: number; total: number; startedAt: number }

export default function CharacterReadProgress({ progress }: { progress: CharacterReadProgressState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const busy = progress.completed < progress.total;
  return <div class="character-read-progress" aria-busy={busy}>
    <div role="status"><LoaderCircle size={16} class={busy ? 'is-spinning' : ''} /><strong>{busy ? '人物と演技を読み取っています…' : '人物と演技の読み取りが完了しました'}</strong><span>処理済み {progress.completed} / {progress.total} 人</span></div>
    <progress value={progress.completed} max={Math.max(1, progress.total)} aria-label="人物と演技の読み取り進捗" />
    {busy ? <small>{progress.completed + 1}人目をローカルで解析中 · {Math.max(0, Math.floor((now - progress.startedAt) / 1000))}秒経過</small> : <small>編集画面を準備しています…</small>}
  </div>;
}
