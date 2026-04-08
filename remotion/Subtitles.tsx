import React from "react";
import { useCurrentFrame, interpolate, spring } from "remotion";

interface SubtitlesProps {
  text: string;
  style: string;
  durationInFrames: number;
  fps: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanNarration(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\.{3,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoGroups(words: string[], groupSize: number): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < words.length; i += groupSize) {
    groups.push(words.slice(i, i + groupSize));
  }
  return groups;
}

function getGroupSize(style: string): number {
  switch (style) {
    case "hormozi":
      return 3;
    case "classic":
      return 4;
    case "minimal":
      return 5;
    case "karaoke":
      return 2;
    case "neon":
      return 3;
    case "outline":
      return 3;
    case "typewriter":
      return 4;
    case "bounce":
      return 3;
    case "split":
      return 3;
    case "gradient":
      return 3;
    default:
      return 3;
  }
}

// ---------------------------------------------------------------------------
// Style renderers
// ---------------------------------------------------------------------------

type StyleRenderer = (params: {
  group: string[];
  frame: number;
  fps: number;
  groupStartFrame: number;
  groupDuration: number;
}) => React.CSSProperties & { __content?: React.ReactNode };

const basePosition: React.CSSProperties = {
  position: "absolute",
  bottom: 180,
  left: 0,
  right: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  textAlign: "center",
  padding: "0 40px",
};

// ---------- hormozi ----------
const hormoziStyle: StyleRenderer = ({
  group,
  frame,
  fps,
  groupStartFrame,
  groupDuration,
}) => {
  const localFrame = frame - groupStartFrame;
  const scale = interpolate(localFrame, [0, 4], [0.85, 1], {
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(localFrame, [0, 3], [0, 1], {
    extrapolateRight: "clamp",
  });

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 900,
    fontSize: 72,
    color: "white",
    textTransform: "uppercase" as const,
    textShadow: "0 4px 20px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.9)",
    transform: `scale(${scale})`,
    opacity,
    lineHeight: 1.1,
  };
};

// ---------- classic ----------
const classicStyle: StyleRenderer = ({ frame, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const opacity = interpolate(localFrame, [0, 4], [0, 1], {
    extrapolateRight: "clamp",
  });

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 600,
    fontSize: 52,
    color: "white",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 12,
    padding: "12px 32px",
    opacity,
    lineHeight: 1.3,
  };
};

// ---------- minimal ----------
const minimalStyle: StyleRenderer = ({ frame, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const opacity = interpolate(localFrame, [0, 3], [0, 0.75], {
    extrapolateRight: "clamp",
  });

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 400,
    fontSize: 40,
    color: "rgba(255, 255, 255, 0.85)",
    opacity,
    lineHeight: 1.3,
  };
};

// ---------- neon ----------
const neonStyle: StyleRenderer = ({ frame, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const opacity = interpolate(localFrame, [0, 3], [0, 1], {
    extrapolateRight: "clamp",
  });
  const glowIntensity = interpolate(
    Math.sin((localFrame / 30) * Math.PI * 2),
    [-1, 1],
    [10, 25]
  );

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 800,
    fontSize: 64,
    color: "#39FF14",
    textShadow: `0 0 ${glowIntensity}px #39FF14, 0 0 ${glowIntensity * 2}px #39FF14, 0 0 ${glowIntensity * 3}px rgba(57,255,20,0.4)`,
    opacity,
    lineHeight: 1.1,
  };
};

// ---------- outline ----------
const outlineStyle: StyleRenderer = ({ frame, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const opacity = interpolate(localFrame, [0, 3], [0, 1], {
    extrapolateRight: "clamp",
  });

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 900,
    fontSize: 68,
    color: "transparent",
    WebkitTextStroke: "2px white",
    textTransform: "uppercase" as const,
    opacity,
    lineHeight: 1.1,
  };
};

// ---------- typewriter ----------
const typewriterStyle: StyleRenderer = ({
  group,
  frame,
  groupStartFrame,
  groupDuration,
}) => {
  const localFrame = frame - groupStartFrame;
  const fullText = group.join(" ");
  const charsToShow = Math.min(
    fullText.length,
    Math.floor(
      interpolate(localFrame, [0, Math.min(groupDuration * 0.6, 20)], [0, fullText.length], {
        extrapolateRight: "clamp",
      })
    )
  );

  return {
    ...basePosition,
    fontFamily: "JetBrains Mono, monospace",
    fontWeight: 500,
    fontSize: 44,
    color: "#39FF14",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 8,
    padding: "12px 28px",
    lineHeight: 1.4,
    __content: (
      <span>
        {fullText.slice(0, charsToShow)}
        <span style={{ opacity: Math.round(localFrame / 8) % 2 === 0 ? 1 : 0 }}>
          _
        </span>
      </span>
    ),
  } as React.CSSProperties & { __content?: React.ReactNode };
};

// ---------- bounce ----------
const bounceStyle: StyleRenderer = ({ frame, fps, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const s = spring({
    frame: localFrame,
    fps,
    config: { damping: 8, stiffness: 150, mass: 0.6 },
  });
  const translateY = interpolate(s, [0, 1], [60, 0]);
  const opacity = interpolate(s, [0, 1], [0, 1]);

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 900,
    fontSize: 68,
    color: "#FACC15",
    textShadow: "0 4px 16px rgba(0,0,0,0.7)",
    transform: `translateY(${translateY}px)`,
    opacity,
    lineHeight: 1.1,
  };
};

// ---------- gradient ----------
const gradientStyle: StyleRenderer = ({ frame, groupStartFrame }) => {
  const localFrame = frame - groupStartFrame;
  const opacity = interpolate(localFrame, [0, 4], [0, 1], {
    extrapolateRight: "clamp",
  });

  return {
    ...basePosition,
    fontFamily: "Outfit, sans-serif",
    fontWeight: 800,
    fontSize: 64,
    color: "#A855F7",
    textShadow: "0 4px 20px rgba(168, 85, 247, 0.5), 0 2px 8px rgba(0,0,0,0.6)",
    opacity,
    lineHeight: 1.1,
  };
};

const styleMap: Record<string, StyleRenderer> = {
  hormozi: hormoziStyle,
  classic: classicStyle,
  minimal: minimalStyle,
  neon: neonStyle,
  outline: outlineStyle,
  typewriter: typewriterStyle,
  bounce: bounceStyle,
  gradient: gradientStyle,
  // karaoke and split are handled inline because they need per-word rendering
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const Subtitles: React.FC<SubtitlesProps> = ({
  text,
  style,
  durationInFrames,
  fps,
}) => {
  const frame = useCurrentFrame();

  const cleaned = cleanNarration(text);
  if (!cleaned) return null;

  const words = cleaned.split(" ").filter(Boolean);
  const groupSize = getGroupSize(style);
  const groups = splitIntoGroups(words, groupSize);

  if (groups.length === 0) return null;

  const framesPerGroup = Math.max(1, Math.floor(durationInFrames / groups.length));

  // Determine which group is active
  const activeIndex = Math.min(
    groups.length - 1,
    Math.floor(frame / framesPerGroup)
  );
  const activeGroup = groups[activeIndex];
  const groupStartFrame = activeIndex * framesPerGroup;

  // ---------- karaoke ----------
  if (style === "karaoke") {
    const wordsFlat = words;
    const framesPerWord = Math.max(1, Math.floor(durationInFrames / wordsFlat.length));
    const activeWordIndex = Math.min(
      wordsFlat.length - 1,
      Math.floor(frame / framesPerWord)
    );

    // Show 2 words at a time, centered around active word
    const pairStart = Math.floor(activeWordIndex / 2) * 2;
    const pairWords = wordsFlat.slice(pairStart, pairStart + 2);

    return (
      <div
        style={{
          ...basePosition,
          fontFamily: "Outfit, sans-serif",
          fontWeight: 800,
          fontSize: 68,
          lineHeight: 1.1,
          gap: 16,
        }}
      >
        {pairWords.map((word, wi) => {
          const globalWordIndex = pairStart + wi;
          const isActive = globalWordIndex === activeWordIndex;
          return (
            <span
              key={wi}
              style={{
                color: isActive ? "#FF6E00" : "white",
                textShadow: isActive
                  ? "0 0 20px rgba(255,110,0,0.6), 0 4px 12px rgba(0,0,0,0.8)"
                  : "0 4px 12px rgba(0,0,0,0.8)",
                transform: isActive ? "scale(1.15)" : "scale(1)",
                transition: "all 0.1s ease",
                display: "inline-block",
                marginRight: 12,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  // ---------- split ----------
  if (style === "split") {
    const localFrame = frame - groupStartFrame;
    const opacity = interpolate(localFrame, [0, 3], [0, 1], {
      extrapolateRight: "clamp",
    });

    return (
      <div
        style={{
          ...basePosition,
          fontFamily: "Outfit, sans-serif",
          fontWeight: 800,
          fontSize: 64,
          lineHeight: 1.1,
          opacity,
        }}
      >
        {activeGroup.map((word, wi) => (
          <span
            key={wi}
            style={{
              color: wi === 0 ? "#A855F7" : "white",
              textShadow: "0 4px 16px rgba(0,0,0,0.7)",
              marginRight: 12,
            }}
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ---------- all other styles ----------
  const renderer = styleMap[style] || styleMap.hormozi;
  const result = renderer({
    group: activeGroup,
    frame,
    fps,
    groupStartFrame,
    groupDuration: framesPerGroup,
  });

  const { __content, ...cssProps } = result as React.CSSProperties & {
    __content?: React.ReactNode;
  };

  return (
    <div style={cssProps}>
      {__content ?? activeGroup.join(" ")}
    </div>
  );
};
