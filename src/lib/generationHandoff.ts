import type { MangaDocument } from '../types.ts';
import { omayFileName, omnyFileName, toOmayYaml, toSeparatedMangaYaml } from './manga.ts';

export interface AgentWorkflowYamlFile {
  fileName: string;
  yaml: string;
}

/**
 * Export the work's pure OMNY YAML (and work-specific OMAY YAML when configured)
 * for external-agent manga generation, without ZIP wrapping or plain-text replacement.
 */
export function agentWorkflowYamlFiles(document: MangaDocument): AgentWorkflowYamlFile[] {
  const title = document.manga.meta.title;
  const files: AgentWorkflowYamlFile[] = [
    { fileName: omnyFileName(title), yaml: toSeparatedMangaYaml(document) },
  ];
  if (document.manga.artwork_settings) {
    files.push({ fileName: omayFileName(title, 'generation'), yaml: toOmayYaml(document) });
  }
  return files;
}
