import levenshtein from 'fast-levenshtein';
import { readFile, writeFile } from '../utils/fileOps';

export function applyEdit(
  filePath: string,
  search: string,
  replace: string,
  options: { fuzzy: boolean; ignoreWhitespace: boolean },
) {
  let fileContent = readFile(filePath);
  let searchNormalized = search;
  if (options.ignoreWhitespace) {
    searchNormalized = normalizeWhitespace(search);
    fileContent = normalizeWhitespace(fileContent);
  }
  let index = fileContent.indexOf(searchNormalized);
  if (index === -1 && options.fuzzy) {
    index = findFuzzyMatch(fileContent, searchNormalized, 0.8); // 80% similarity
  }
  if (index === -1) {
    throw new Error('Search block not found');
  }
  const newContent =
    fileContent.substring(0, index) +
    replace +
    fileContent.substring(index + searchNormalized.length);
  writeFile(filePath, newContent);
}

function findFuzzyMatch(content: string, target: string, threshold: number): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i <= content.length - target.length; i++) {
    const substr = content.substr(i, target.length);
    const distance = levenshtein.get(substr, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const similarity = 1 - bestDistance / target.length;
  if (similarity >= threshold) {
    return bestIndex;
  }
  return -1;
}

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}
