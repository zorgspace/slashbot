import { parseXml } from './xmlParser';
import { applyEdit } from './searchReplace';
import { writeFile } from '../utils/fileOps';

export function handleEdit(editTag: string, filePath: string) {
  const parsed = parseXml(editTag);
  const content = parsed.content;
  const mode = parsed.mode || 'full';
  const options = {
    fuzzy: parsed.fuzzy === 'true',
    ignoreWhitespace: parsed.ignoreWhitespace === 'true',
  };
  if (mode === 'searchReplace') {
    const searchBlock = parsed.search;
    const replaceBlock = parsed.replace;
    applyEdit(filePath, searchBlock, replaceBlock, options);
  } else {
    // full rewrite
    writeFile(filePath, content);
  }
}
