// Template "highlight" — a generic, looping highlight video for a club/organisation.
// Comvenio provides ONLY the reusable structure; ALL content (names, dates, logos,
// colours, list rows, closing line) arrives via props — nothing org-specific is hard-coded.
// Layout keeps content in a central "safe zone" so a mobile cover-crop stays readable,
// and the last second settles back toward the first so the background loop is near-seamless.
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
import { FONT_STACK } from "./Branding";
import { HIGHLIGHT_PARTNERS_EXTRA_FRAMES } from "./types";
import type { HighlightProps } from "./types";

// Neutral fallback palette (Comvenio teal family) — real colours come from props.
const DEFAULTS = {
  brand: "#0E847B",
  green: "#2F8F7D",
  cream: "#F4EFE6",
  gold: "#C9A44C",
  dark: "#17120D",
};

// Fade a layer in/out over a frame window.
const win = (
  frame: number,
  start: number,
  end: number,
  fadeIn = 12,
  fadeOut = 12,
): number =>
  interpolate(frame, [start, start + fadeIn, end - fadeOut, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

// ---------- continuously animated background ----------
const Background: React.FC<{ background?: string; brand: string }> = ({ background, brand }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = (frame / durationInFrames) * Math.PI * 2; // sine breathe → loop-safe
  const scale = 1.09 + Math.sin(t) * 0.02;
  const period = durationInFrames / 2; // divides duration → loop-safe sweep
  const sweep = interpolate(frame % period, [0, period], [-70, 190]);
  return (
    <AbsoluteFill style={{ background: brand, overflow: "hidden" }}>
      {background ? (
        <Img
          src={staticFile(background)}
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }}
        />
      ) : (
        <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${brand}, #0a3d39)` }} />
      )}
      <div
        style={{
          position: "absolute",
          top: "-50%",
          left: `${sweep}%`,
          width: "35%",
          height: "200%",
          transform: "rotate(16deg)",
          background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.13) 50%, transparent 100%)",
          filter: "blur(8px)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.28) 78%, rgba(0,0,0,0.52) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------- scene 1: logo opener ----------
const Opener: React.FC<{ logo?: string; kicker?: string; cream: string; start: number; end: number }> = ({
  logo,
  kicker,
  cream,
  start,
  end,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - start - 4, fps, config: { damping: 14, stiffness: 90 } });
  const scale = interpolate(enter, [0, 1], [0.7, 1]);
  const o = win(frame, start, end, 14, 16);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
        {logo ? (
          <Img src={staticFile(logo)} style={{ height: 560, filter: "drop-shadow(0 14px 34px rgba(0,0,0,0.5))" }} />
        ) : null}
        {kicker ? (
          <div
            style={{
              marginTop: 26,
              fontFamily: FONT_STACK,
              color: cream,
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "0.42em",
              textShadow: "0 3px 12px rgba(0,0,0,0.6)",
            }}
          >
            {kicker}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene 2: hero image ----------
const Hero: React.FC<{ heroImage?: string; start: number; end: number }> = ({ heroImage, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 80 } });
  const scale = interpolate(enter, [0, 1], [0.78, 1]);
  const rot = interpolate(enter, [0, 1], [-4, 0]);
  const o = win(frame, start, end, 14, 18);
  const shine = interpolate(frame, [start + 20, start + 60], [-60, 160], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ position: "relative", transform: `scale(${scale}) rotate(${rot}deg)` }}>
        {heroImage ? (
          <Img src={staticFile(heroImage)} style={{ height: 740, filter: "drop-shadow(0 18px 40px rgba(0,0,0,0.55))" }} />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${shine}%`,
            width: "22%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
            filter: "blur(6px)",
            mixBlendMode: "screen",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene 3: title + date ----------
const TitleDate: React.FC<{
  heroImage?: string;
  title: string;
  subtitle?: string;
  dateRange?: string;
  cream: string;
  green: string;
  gold: string;
  start: number;
  end: number;
}> = ({ heroImage, title, subtitle, dateRange, cream, green, gold, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = win(frame, start, end, 14, 16);
  const titleUp = spring({ frame: frame - start - 6, fps, config: { damping: 200 } });
  const chip = spring({ frame: frame - start - 18, fps, config: { damping: 13, stiffness: 140 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ textAlign: "center", fontFamily: FONT_STACK }}>
        {heroImage ? (
          <Img
            src={staticFile(heroImage)}
            style={{ height: 210, marginBottom: 24, filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.5))" }}
          />
        ) : null}
        {subtitle ? (
          <div style={{ color: cream, fontSize: 46, fontWeight: 700, letterSpacing: "0.16em", marginBottom: 8 }}>
            {subtitle.toUpperCase()}
          </div>
        ) : null}
        <div
          style={{
            color: cream,
            fontSize: 118,
            fontWeight: 900,
            letterSpacing: "0.02em",
            lineHeight: 1,
            transform: `translateY(${(1 - titleUp) * 50}px)`,
            textShadow: "0 6px 22px rgba(0,0,0,0.55)",
          }}
        >
          {title.toUpperCase()}
        </div>
        {dateRange ? (
          <div
            style={{
              marginTop: 40,
              display: "inline-block",
              transform: `scale(${chip})`,
              background: green,
              color: cream,
              border: `4px solid ${gold}`,
              borderRadius: 22,
              padding: "20px 52px",
              fontSize: 62,
              fontWeight: 800,
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            }}
          >
            {dateRange}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene 4: item list (vertical, mobile-safe) ----------
const ItemList: React.FC<{
  items: HighlightProps["items"];
  heading?: string;
  cream: string;
  green: string;
  gold: string;
  start: number;
  end: number;
}> = ({ items, heading, cream, green, gold, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = win(frame, start, end, 12, 16);
  const headOpacity = win(frame, start, end, 10, 16);
  const rows = items ?? [];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ width: 1120, fontFamily: FONT_STACK, textAlign: "center" }}>
        {heading ? (
          <div
            style={{
              color: cream,
              fontSize: 46,
              fontWeight: 800,
              letterSpacing: "0.34em",
              opacity: headOpacity,
              marginBottom: 34,
              textShadow: "0 3px 14px rgba(0,0,0,0.6)",
            }}
          >
            {heading.toUpperCase()}
          </div>
        ) : null}
        {rows.map((d, i) => {
          const rowEnter = spring({ frame: frame - start - 14 - i * 12, fps, config: { damping: 16, stiffness: 120 } });
          const x = interpolate(rowEnter, [0, 1], [-70, 0]);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 30,
                background: "rgba(23,18,13,0.62)",
                border: `2px solid ${gold}`,
                borderRadius: 20,
                padding: "18px 30px",
                marginBottom: 22,
                transform: `translateX(${x}px)`,
                opacity: rowEnter,
                boxShadow: "0 8px 24px rgba(0,0,0,0.38)",
              }}
            >
              {d.label ? (
                <div
                  style={{
                    flexShrink: 0,
                    background: green,
                    color: cream,
                    borderRadius: 14,
                    padding: "12px 22px",
                    fontSize: 34,
                    fontWeight: 800,
                    minWidth: 250,
                    textAlign: "center",
                  }}
                >
                  {d.label.toUpperCase()}
                </div>
              ) : null}
              {d.logo ? (
                <Img src={staticFile(d.logo)} style={{ height: 92, width: 120, objectFit: "contain", flexShrink: 0 }} />
              ) : null}
              <div
                style={{
                  color: cream,
                  fontSize: 46,
                  fontWeight: 800,
                  textAlign: "left",
                  flexGrow: 1,
                  textShadow: "0 2px 8px rgba(0,0,0,0.5)",
                }}
              >
                {d.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene 5: note + sponsors ----------
const NoteSponsors: React.FC<{
  noteText?: string;
  sponsors?: string[];
  cream: string;
  gold: string;
  start: number;
  end: number;
}> = ({ noteText, sponsors, cream, gold, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = win(frame, start, end, 12, 16);
  const pop = spring({ frame: frame - start - 6, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ textAlign: "center", fontFamily: FONT_STACK }}>
        {noteText ? (
          <div
            style={{
              color: cream,
              fontSize: 78,
              fontWeight: 900,
              letterSpacing: "0.04em",
              transform: `scale(${interpolate(pop, [0, 1], [0.8, 1])})`,
              textShadow: "0 5px 18px rgba(0,0,0,0.55)",
            }}
          >
            {noteText.toUpperCase()}
          </div>
        ) : null}
        {sponsors && sponsors.length ? (
          <div style={{ marginTop: 44, display: "flex", gap: 40, justifyContent: "center", alignItems: "center" }}>
            {sponsors.map((s, i) => (
              <div
                key={i}
                style={{
                  background: cream,
                  borderRadius: 18,
                  padding: 16,
                  border: `3px solid ${gold}`,
                  boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                }}
              >
                <Img src={staticFile(s)} style={{ height: 110, objectFit: "contain", borderRadius: 8 }} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---------- optional scene: partner cards (catering, beverages, venue …) ----------
const Partners: React.FC<{
  partners?: HighlightProps["partners"];
  cream: string;
  gold: string;
  start: number;
  end: number;
}> = ({ partners, cream, gold, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = win(frame, start, end, 12, 16);
  const rows = partners ?? [];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ width: 1240, fontFamily: FONT_STACK }}>
        {rows.map((p, i) => {
          const enter = spring({ frame: frame - start - 12 - i * 14, fps, config: { damping: 16, stiffness: 120 } });
          const y = interpolate(enter, [0, 1], [60, 0]);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 40,
                background: "rgba(23,18,13,0.62)",
                border: `2px solid ${gold}`,
                borderRadius: 24,
                padding: "26px 42px",
                marginBottom: 30,
                transform: `translateY(${y}px)`,
                opacity: enter,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              {p.logo ? (
                <div
                  style={{
                    flexShrink: 0,
                    background: cream,
                    borderRadius: 18,
                    padding: 14,
                    border: `3px solid ${gold}`,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
                  }}
                >
                  <Img src={staticFile(p.logo)} style={{ height: 132, width: 132, objectFit: "contain" }} />
                </div>
              ) : null}
              <div style={{ textAlign: "left", flexGrow: 1 }}>
                <div
                  style={{
                    color: cream,
                    fontSize: 52,
                    fontWeight: 900,
                    lineHeight: 1.1,
                    textShadow: "0 2px 10px rgba(0,0,0,0.5)",
                  }}
                >
                  {p.name}
                </div>
                {p.subtitle ? (
                  <div style={{ marginTop: 12, color: gold, fontSize: 33, fontWeight: 700, lineHeight: 1.25 }}>
                    {p.subtitle}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scene 6: closing (settles toward opener for a near-seamless loop) ----------
const Closing: React.FC<{
  logo?: string;
  closingText?: string;
  orgName?: string;
  cream: string;
  gold: string;
  start: number;
  end: number;
}> = ({ logo, closingText, orgName, cream, gold, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = win(frame, start, end, 14, 10);
  const pop = spring({ frame: frame - start - 4, fps, config: { damping: 15 } });
  const pulse = 1 + Math.sin(((frame - start) / fps) * Math.PI * 1.4) * 0.02;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ textAlign: "center", fontFamily: FONT_STACK, transform: `scale(${pulse})` }}>
        {logo ? (
          <Img src={staticFile(logo)} style={{ height: 320, marginBottom: 30, filter: "drop-shadow(0 10px 26px rgba(0,0,0,0.5))" }} />
        ) : null}
        {closingText ? (
          <div
            style={{
              color: cream,
              fontSize: 84,
              fontWeight: 900,
              letterSpacing: "0.01em",
              transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`,
              textShadow: "0 6px 22px rgba(0,0,0,0.55)",
            }}
          >
            {closingText}
          </div>
        ) : null}
        {orgName ? (
          <div style={{ marginTop: 22, color: gold, fontSize: 40, fontWeight: 700, letterSpacing: "0.1em" }}>
            {orgName}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const Highlight: React.FC<HighlightProps> = (props) => {
  const brand = props.brandColor || DEFAULTS.brand;
  const green = props.greenColor || DEFAULTS.green;
  const cream = props.creamColor || DEFAULTS.cream;
  const gold = props.goldColor || DEFAULTS.gold;

  // scene windows (frames @30fps) — overlap slightly for smooth flow. Base total is
  // 600; the optional partners scene inserts HIGHLIGHT_PARTNERS_EXTRA_FRAMES between
  // the item list and the note, shifting the last two scenes back by the same amount.
  const hasPartners = (props.partners?.length ?? 0) > 0;
  const shift = hasPartners ? HIGHLIGHT_PARTNERS_EXTRA_FRAMES : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: brand }}>
      <Background background={props.background} brand={brand} />
      <Opener logo={props.logo} kicker={props.kicker} cream={cream} start={0} end={100} />
      <Hero heroImage={props.heroImage} start={88} end={222} />
      <TitleDate
        heroImage={props.heroImage}
        title={props.title}
        subtitle={props.subtitle}
        dateRange={props.dateRange}
        cream={cream}
        green={green}
        gold={gold}
        start={212}
        end={322}
      />
      <ItemList items={props.items} heading={props.itemsHeading} cream={cream} green={green} gold={gold} start={312} end={458} />
      {hasPartners ? (
        <Partners
          partners={props.partners}
          cream={cream}
          gold={gold}
          start={448}
          end={448 + HIGHLIGHT_PARTNERS_EXTRA_FRAMES + 10}
        />
      ) : null}
      <NoteSponsors noteText={props.noteText} sponsors={props.sponsors} cream={cream} gold={gold} start={448 + shift} end={524 + shift} />
      <Closing
        logo={props.logo}
        closingText={props.closingText}
        orgName={props.orgName}
        cream={cream}
        gold={gold}
        start={514 + shift}
        end={600 + shift}
      />
    </AbsoluteFill>
  );
};
