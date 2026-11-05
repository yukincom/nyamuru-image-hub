import { createContext, type JSX, type Ref } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { chooseBrowserFiles } from '../lib/browserFiles';
import type { ProjectFilePicker } from '../lib/projectFilePicker';

export const ProjectFileContext = createContext<{
  chooseFiles: ProjectFilePicker;
  onError: (message: string) => void;
} | null>(null);

export function useProjectFilePicker(): ProjectFilePicker {
  return useContext(ProjectFileContext)?.chooseFiles ?? chooseBrowserFiles;
}

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type' | 'ref' | 'onChange' | 'onClick'> & {
  inputRef?: Ref<HTMLInputElement>;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<unknown>;
};

/** The native input remains available for drag/drop, automation, and unbound documents. */
export default function ProjectFileInput({ inputRef, accept, multiple = false, onFiles, ...props }: Props) {
  const context = useContext(ProjectFileContext);
  const choosing = useRef(false);
  return <input {...props} ref={inputRef} type="file" accept={accept} multiple={multiple}
    onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      void onFiles(files);
    }}
    onClick={event => {
      if (!context) return;
      event.preventDefault();
      if (choosing.current) return;
      choosing.current = true;
      void context.chooseFiles(accept, multiple).then(files => onFiles(files))
        .catch(error => context.onError(error instanceof Error ? error.message : 'ファイルを選べませんでした'))
        .finally(() => { choosing.current = false; });
    }} />;
}
