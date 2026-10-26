export function paintHelpItems(text:string):string[] {
  return text.split(/\n+/)
    .flatMap(line=>line.match(/[^。！？]+[。！？]?/g)??[])
    .map(line=>line.trim())
    .filter(Boolean);
}
