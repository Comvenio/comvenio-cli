// Template "teaser" (K7): event announcement — title, date chip, countdown look, CTA.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandBar, FONT_STACK, FadeInOut, LogoCorner } from "./Branding";
import type { TeaserProps } from "./types";

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

export const Teaser: React.FC<TeaserProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = spring({ frame: frame - fps * 0.3, fps, config: { damping: 200 } });
  const chipEnter = spring({ frame: frame - fps * 1.1, fps, config: { damping: 14 } });
  const ctaOpacity = interpolate(frame, [fps * 2, fps * 2.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = 1 + Math.sin((frame / fps) * Math.PI * 1.5) * 0.02;

  return (
    <FadeInOut>
      {props.backgroundImage ? (
        <AbsoluteFill>
          <Img
            src={staticFile(props.backgroundImage)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <AbsoluteFill style={{ background: "rgba(8,10,14,0.62)" }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{ background: `linear-gradient(150deg, #12161a 10%, ${props.brandColor} 230%)` }}
        />
      )}

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          fontFamily: FONT_STACK,
          color: "#fff",
          textAlign: "center",
          padding: 120,
        }}
      >
        <div
          style={{
            fontSize: 100,
            fontWeight: 900,
            lineHeight: 1.08,
            maxWidth: 1400,
            transform: `translateY(${(1 - titleEnter) * 60}px)`,
            opacity: titleEnter,
            textShadow: "0 4px 18px rgba(0,0,0,0.45)",
          }}
        >
          {props.title}
        </div>

        <div
          style={{
            marginTop: 56,
            display: "flex",
            gap: 24,
            alignItems: "center",
            transform: `scale(${chipEnter})`,
          }}
        >
          <div
            style={{
              background: props.brandColor,
              borderRadius: 18,
              padding: "18px 42px",
              fontSize: 42,
              fontWeight: 700,
              boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
            }}
          >
            {formatDate(props.date)}
          </div>
          {typeof props.daysUntil === "number" && props.daysUntil >= 0 ? (
            <div
              style={{
                border: "3px solid rgba(255,255,255,0.7)",
                borderRadius: 18,
                padding: "15px 36px",
                fontSize: 40,
                fontWeight: 800,
                transform: `scale(${pulse})`,
              }}
            >
              {props.daysUntil === 0 ? "HEUTE" : `NOCH ${props.daysUntil} TAGE`}
            </div>
          ) : null}
        </div>

        {props.location ? (
          <div style={{ marginTop: 36, fontSize: 40, fontWeight: 500, opacity: 0.85 }}>
            📍 {props.location}
          </div>
        ) : null}

        {props.ctaText ? (
          <div
            style={{
              marginTop: 60,
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: "0.06em",
              opacity: ctaOpacity,
            }}
          >
            {props.ctaText}
          </div>
        ) : null}
      </AbsoluteFill>
      <LogoCorner logoFile={props.logoFile} />
      <BrandBar brandColor={props.brandColor} />
    </FadeInOut>
  );
};
