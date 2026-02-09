export function parseXml(xml: string): any {
  const obj: any = {};
  // parse attributes
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(xml)) !== null) {
    obj[match[1]] = match[2];
  }
  // parse content for full mode
  const contentMatch = xml.match(/>(.*)</s);
  if (contentMatch) obj.content = contentMatch[1];
  // parse search and replace for searchReplace mode
  const searchMatch = xml.match(/<search>(.*?)<\/search>/s);
  if (searchMatch) obj.search = searchMatch[1];
  const replaceMatch = xml.match(/<replace>(.*?)<\/replace>/s);
  if (replaceMatch) obj.replace = replaceMatch[1];
  return obj;
}
