import readmeMarkdownJa from '../content/agent-manga-generation-workflow-readme.md?raw';
import readmeMarkdownEn from '../content/agent-manga-generation-workflow-readme.en.md?raw';
import workflowMarkdownJa from '../content/agent-manga-generation-workflow.md?raw';
import workflowMarkdownEn from '../content/agent-manga-generation-workflow.en.md?raw';
import standardOmaySource from '../content/standard-settings.yaml?raw';
import DownloadableMarkdownGuide from './DownloadableMarkdownGuide';
import type { DocsLanguage } from '../types';

interface Props {
  lang: DocsLanguage;
  onChangeLang: (lang: DocsLanguage) => void;
  onNotify: (message: string) => void;
  onOpenMeta: () => void;
}

export default function AgentWorkflowGuide({ lang, onChangeLang, onNotify, onOpenMeta }: Props) {
  const en = lang === 'en';
  return <DownloadableMarkdownGuide
    readmeMarkdown={en ? readmeMarkdownEn : readmeMarkdownJa}
    markdown={en ? workflowMarkdownEn : workflowMarkdownJa}
    eyebrow="AGENT WORKFLOW"
    title={en ? 'Agent Manga Generation Workflow' : 'エージェント漫画生成ワークフロー'}
    description={en
      ? 'Steps for an agent to generate and inspect manga from storyboard YAML and character assets.'
      : '構成データ（YAML）とキャラクター素材から漫画を生成・検品するエージェント向け手順です。'}
    fileName={en ? 'agent-manga-generation-workflow.en.md' : 'agent-manga-generation-workflow.md'}
    resourceName={en ? 'generation workflow' : '生成ワークフロー'}
    attachments={[{
      label: en ? 'Standard artwork settings (YAML)' : '標準作画設定（YAML）',
      description: en
        ? 'Drawing & staging rules (style_notes) and the layout spec (layout_spec) for turning OMNY into finished manga. Set it once in the image-generation side project instructions; per work, pass only the OMNY file.'
        : 'ストーリーOMNYを漫画として描くための作画・演出ルール（style_notes）とレイアウト仕様（layout_spec）。画像生成側のプロジェクト指示に一度設定すれば、作品ごとに渡すのはストーリーOMNYだけで済みます。',
      fileName: 'standard-settings.yaml',
      content: standardOmaySource,
      link: { label: en ? 'Open the studio; use Environment Settings for editing and export' : 'スタジオを開く（編集・書き出しは環境設定から）', onClick: onOpenMeta },
    }]}
    lang={lang}
    onChangeLang={onChangeLang}
    onNotify={onNotify}
  />;
}
