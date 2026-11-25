// What Tab does to the console's line (#355): pure, so a unit test reaches it without the DOM. devconsole.ts calls it with
// the words Commands.complete offers for the line.

/** The line after a Tab, and the words to list when Tab can't decide between them. */
export interface TabResult {
  line: string;
  choices: readonly string[];
}

/**
 * Completes the last word of `line` from `options` (the words that could finish it): one option fills it in and adds a
 * space, several fill in what they share. `choices` lists them when there is more than one.
 */
export function tabComplete(line: string, options: readonly string[]): TabResult {
  if (options.length === 0) return { line, choices: [] };
  const start = line.search(/\S*$/); // where the last word starts; a line ending in a space starts an empty one
  const head = line.slice(0, start);
  if (options.length === 1) return { line: `${head}${options[0]} `, choices: [] };
  const shared = sharedStart(options);
  const typed = line.slice(start);
  // fill in only a start every option spells the same way, so the result doesn't depend on their order
  const fill = shared.length > typed.length && options.every(o => o.startsWith(shared));
  return { line: fill ? head + shared : line, choices: options };
}

/** The longest start every word shares, ignoring case, spelled as the first word spells it. */
function sharedStart(words: readonly string[]): string {
  let n = words[0].length;
  for (const w of words) {
    let i = 0;
    while (i < n && i < w.length && w[i].toLowerCase() === words[0][i].toLowerCase()) i++;
    n = i;
  }
  return words[0].slice(0, n);
}
