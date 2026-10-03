/**
 * Finds color values in source text. Outside src/theme/, the app writes no
 * color value: every color is a token from the theme (docs/design/theming.md).
 */

const CSS_NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const HEX = /#[0-9a-f]{3,8}\b/gi;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const WORD = /[a-z]+/gi;

function namedColorsIn(value: string): string[] {
  return (value.match(WORD) ?? []).filter((word) =>
    CSS_NAMED_COLORS.has(word.toLowerCase()),
  );
}

/** Color values in a stylesheet, outside comments. */
export function colorsInCss(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Declaration values only, so selectors and property names never match.
  const values = [...code.matchAll(/:\s*([^;{}]+)[;}]/g)].map((match) =>
    match[1].replace(/url\([^)]*\)/g, "").replace(/var\([^)]*\)/g, ""),
  );
  return values.flatMap((value) => [
    ...(value.match(HEX) ?? []),
    ...(value.match(COLOR_FUNCTION) ?? []),
    ...namedColorsIn(value),
  ]);
}

const COLOR_ATTRIBUTE =
  /\b(?:fill|stroke|color|stopColor|floodColor|lightingColor)=["']([^"']*)["']/g;
const COLOR_STYLE_KEY =
  /\b(?:color|background|backgroundColor|borderColor|border|fill|stroke|outline|outlineColor|boxShadow|textShadow|caretColor|accentColor)\s*:\s*["'`]([^"'`]*)["'`]/g;

/** Color values in TypeScript or TSX: in string literals, attributes, and inline styles. */
export function colorsInScript(text: string): string[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const strings = [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(
    (match) => match[2],
  );
  const inStrings = strings.flatMap((value) => [
    ...(value.match(HEX) ?? []),
    ...(value.match(COLOR_FUNCTION) ?? []),
  ]);
  const named = [
    ...[...code.matchAll(COLOR_ATTRIBUTE)].map((match) => match[1]),
    ...[...code.matchAll(COLOR_STYLE_KEY)].map((match) => match[1]),
  ].flatMap(namedColorsIn);
  return [...inStrings, ...named];
}
