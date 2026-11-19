// Quote structural Markdown only when free text would otherwise be read as a record boundary.
const quoted = '<!-- peak-distance:quoted-text -->';

export function encodeProse(text: string, boundary: RegExp): string {
  if (!boundary.test(text) && !text.startsWith(quoted)) return text;
  return quoted + '\n' + text.split('\n').map(line => '> ' + line).join('\n');
}

export function decodeProse(text: string): string {
  const [header, ...lines] = text.split('\n');
  if (header !== quoted || !lines.length || !lines.every(line => line.startsWith('> '))) return text;
  return lines.map(line => line.slice(2)).join('\n');
}
