import { forwardRef } from "react";

/** Torob's radish (public/brand/radish.png) pixel for pixel, 19x19. The eyes (two black pixels) and the
    mouth are drawn on top, so they can look around and smile. While the code is typed it covers its eyes
    with its paws: that face is drawn on a half-pixel grid (38x38) over the same body. */
const GRID = [
  ".....aaaa.aaaa.....",
  ".....abbaaabba.....",
  ".....abbbabbba.....",
  ".....aabbbbbaa.....",
  "......aabbbaa......",
  "....cccdddddccc....",
  "...ccdddddddddcc...",
  "..ccdddddddddddcc..",
  "..cdddddddddddddc..",
  ".ccdddddddddddddcc.",
  ".cdddddddddddddddc.",
  ".cdddddddddddddddc.",
  ".cdddddddddddddddc.",
  ".ccdddddddddddddcc.",
  "..cdddddddddddddc..",
  "..ccdddddddddddcc..",
  "...cccfffffffccc...",
  ".....cccfffccc.....",
  ".......ccfcc.......",
];
const N = 19;
const OUTLINE = "#860426";
const COLORS: Record<string, string> = { a: "#587925", b: "#90b35b", c: OUTLINE, d: "#f04f78", f: "#ffdae3" };
const BODY = GRID.flatMap((row, y) => [...row].flatMap((ch, x) => (COLORS[ch] ? [{ x, y, c: COLORS[ch] }] : [])));

/** The covering face on the half-pixel grid (rows 19-26 of 38): paws over closed eyes. */
const COVER_TOP = 19;
const COVER_FACE = [
  "...........ccc.........cccc...........",
  "..........c...c........c...c..........",
  ".........cc....c......c....cc.........",
  ".........c.....c......c.....c.........",
  "........c.....cc......cc.....c........",
  "........c.....cc......cc.....c........",
  ".............cc........cc.............",
  ".........cccc............cccc.........",
];
const COVER_MOUTH = [[18, 22], [19, 22], [18, 23], [19, 23]];
const COVER = [
  ...COVER_FACE.flatMap((row, j) => [...row].flatMap((ch, i) => (ch === "c" ? [[i, j + COVER_TOP]] : []))),
  ...COVER_MOUTH,
];

/** Where the eyes sit, as a fraction of the drawing, for working out where they are on screen. */
export const EYE_CENTER = { fx: 8 / N, fy: 12 / N };

type Props = {
  /** How far the eyes look, -1 to 1 each way (fractions of a pixel are fine: each typed letter moves them). */
  gaze: { x: number; y: number };
  /** Paws over the eyes (while the code is typed). */
  covering?: boolean;
  happy?: boolean;
  size?: number;
};

const PixelRadish = forwardRef<SVGSVGElement, Props>(function PixelRadish({ gaze, covering, happy, size = 152 }, ref) {
  const mouth = happy ? [[6, 12], [7, 13], [8, 13], [9, 12]] : [[7, 12], [8, 12]];
  return (
    <span className="pixel-radish-wrap" style={{ width: size, height: size }} role="img"
      aria-label={covering ? "تربچه چشم‌هاش رو گرفته" : "تربچه"}>
      <svg ref={ref} className="pixel-radish" width={size} height={size} viewBox={`0 0 ${N} ${N}`} shapeRendering="crispEdges" aria-hidden="true">
        {BODY.map((p) => <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />)}
        <g className={`pixel-radish-face ${covering ? "is-hidden" : ""}`}>
          <g className="pixel-radish-eyes" shapeRendering="geometricPrecision" style={{ transform: `translate(${gaze.x}px, ${gaze.y}px)` }}>
            <rect x={4} y={11} width={1} height={2} fill="#000" />
            <rect x={11} y={11} width={1} height={2} fill="#000" />
          </g>
          {mouth.map(([x, y]) => <rect key={`m${x}-${y}`} x={x} y={y} width={1} height={1} fill={OUTLINE} />)}
        </g>
        <g className={`pixel-radish-cover ${covering ? "is-shown" : ""}`}>
          {COVER.map(([i, j]) => <rect key={`c${i},${j}`} x={i / 2} y={j / 2} width={0.52} height={0.52} fill={OUTLINE} />)}
        </g>
      </svg>
    </span>
  );
});

export default PixelRadish;
