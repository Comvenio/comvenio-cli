// Shared branding layer (K7): accent bar, optional club logo corner, global intro/outro fade.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const FONT_STACK =
  'Inter, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Bottom accent bar in the club color. */
export const BrandBar: React.FC<{ brandColor: string }> = ({ brandColor }) => (
  <div
    style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 18,
      background: brandColor,
    }}
  />
);

/** Club logo in the top-right corner (staged file, optional). */
export const LogoCorner: React.FC<{ logoFile?: string }> = ({ logoFile }) => {
  if (!logoFile) return null;
  return (
    <Img
      src={staticFile(logoFile)}
      style={{
        position: "absolute",
        top: 40,
        right: 48,
        width: 110,
        height: 110,
        objectFit: "contain",
        filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
      }}
    />
  );
};

/** Wraps the whole composition in a global intro/outro fade (0.5s each side). */
export const FadeInOut: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const fade = fps / 2;
  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames - 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ opacity, background: "#000" }}>{children}</AbsoluteFill>;
};
