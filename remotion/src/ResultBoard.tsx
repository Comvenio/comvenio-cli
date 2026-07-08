// Template "result" (K7): match result board — teams, animated score, scorers list.
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrandBar, FONT_STACK, FadeInOut, LogoCorner } from "./Branding";
import type { ResultProps } from "./types";

const formatDate = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
};

const ScoreDigit: React.FC<{ value: number; delayFrames: number }> = ({ value, delayFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delayFrames, fps, config: { damping: 12, mass: 0.8 } });
  return (
    <span style={{ display: "inline-block", transform: `scale(${enter})` }}>{value}</span>
  );
};

export const ResultBoard: React.FC<ResultProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dateLabel = formatDate(props.date);

  const teamsEnter = spring({ frame, fps, config: { damping: 200 } });
  const scorers = props.scorers ?? [];

  return (
    <FadeInOut>
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, #12161a 0%, ${props.brandColor} 220%)`,
          fontFamily: FONT_STACK,
          color: "#fff",
          justifyContent: "center",
          alignItems: "center",
          padding: 100,
        }}
      >
        {props.competition ? (
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              opacity: 0.8,
              marginBottom: 40,
            }}
          >
            {props.competition}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 80,
            transform: `translateY(${(1 - teamsEnter) * 50}px)`,
            opacity: teamsEnter,
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 800, textAlign: "right", maxWidth: 560 }}>
            {props.homeTeam}
          </div>
          <div
            style={{
              fontSize: 140,
              fontWeight: 900,
              padding: "10px 60px",
              borderRadius: 24,
              background: "rgba(255,255,255,0.08)",
              border: `3px solid ${props.brandColor}`,
              display: "flex",
              gap: 28,
              alignItems: "center",
            }}
          >
            <ScoreDigit value={props.homeScore} delayFrames={fps} />
            <span style={{ opacity: 0.6 }}>:</span>
            <ScoreDigit value={props.awayScore} delayFrames={fps * 1.4} />
          </div>
          <div style={{ fontSize: 64, fontWeight: 800, textAlign: "left", maxWidth: 560 }}>
            {props.awayTeam}
          </div>
        </div>

        {scorers.length > 0 ? (
          <div style={{ marginTop: 70, textAlign: "center" }}>
            {scorers.map((s, i) => {
              const delay = fps * 2 + i * (fps * 0.35);
              const o = interpolate(frame, [delay, delay + fps * 0.4], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div key={i} style={{ fontSize: 38, fontWeight: 500, opacity: o * 0.9, lineHeight: 1.6 }}>
                  ⚽ {s}
                </div>
              );
            })}
          </div>
        ) : null}

        {dateLabel ? (
          <div style={{ position: "absolute", bottom: 60, fontSize: 30, opacity: 0.7 }}>
            {dateLabel}
          </div>
        ) : null}
      </AbsoluteFill>
      <LogoCorner logoFile={props.logoFile} />
      <BrandBar brandColor={props.brandColor} />
    </FadeInOut>
  );
};
