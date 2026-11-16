import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import type { ReactNode } from 'react';
import {
  ActionCard,
  Barcode,
  ChromeFigure,
  DropStrip,
  EmptyState,
  HowItWorks,
  InjuryTag,
  Label,
  LeaderLine,
  MarketShift,
  PageHero,
  Panel,
  PositionTag,
  SectionHead,
  SpecGrid,
  Stat,
  Sticker,
  Tag,
  Trend,
} from '@/components/primitives';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ThemePicker } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Design kit — Cheatsheet',
  description: 'Every token and component of the Supply Co. design, in both themes.',
};

/*
 * The design kit: every token and component the app is built from, each
 * drawn twice — once forced dark, once forced light — so a change to a
 * primitive can be checked against both themes in one look. Sample data here
 * is illustrative; the pages never read from this file.
 */

const COLORS: Array<{ name: string; token: string; dark: string; light: string; use: string }> = [
  { name: 'Ink', token: '--color-ink', dark: '#0b0b0c', light: '#f2f0ea', use: 'Page ground' },
  { name: 'Ink hover', token: '--color-ink-hover', dark: '#18181a', light: '#e4e0d5', use: 'Row hover, skeletons' },
  { name: 'Rule', token: '--color-rule', dark: '#2c2c2e', light: '#d3cfc4', use: 'Hairlines between rows' },
  { name: 'Rule bright', token: '--color-rule-bright', dark: '#48484c', light: '#a9a496', use: 'Tag outlines, leaders' },
  { name: 'Text', token: '--color-text', dark: '#f2f0ea', light: '#0b0b0c', use: 'Body, emphasis frames' },
  { name: 'Text dim', token: '--color-text-dim', dark: '#d6d4ce', light: '#2e2d2a', use: 'Secondary copy' },
  { name: 'Text faint', token: '--color-text-faint', dark: '#a3a3a3', light: '#5c5a55', use: 'Labels, meta' },
  { name: 'Accent', token: '--color-accent', dark: '#c8ff00', light: '#c8ff00', use: 'Fill only — black text on it' },
  { name: 'Signal', token: '--color-signal', dark: '#c8ff00', light: '#3f5c00', use: 'Lime as text, stroke, up' },
  { name: 'Fade', token: '--color-fade', dark: '#ff6a3d', light: '#c2410c', use: 'Down, drop, sell' },
  { name: 'Warn', token: '--color-warn', dark: '#ffb340', light: '#9a5200', use: 'Questionable, soon' },
  { name: 'Crit', token: '--color-crit', dark: '#ff5252', light: '#c62828', use: 'Out, bye, now' },
];

export default async function KitPage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader active="/kit" leagues={[]} strip={['Design kit', 'Tokens and components', 'Both themes']} />

      <div className="shell">
        <PageHero
          kicker="[ Kit ] — Supply Co. design system — v1"
          title={
            <>
              Design
              <br />
              <span className="outline-text">kit.</span>
            </>
          }
          aside={
            <>
              <div>
                <div className="eyebrow mb-3">Theme for this page</div>
                <ThemePicker initial={theme} />
              </div>
              <SpecGrid
                items={[
                  { label: 'Faces', value: '2' },
                  { label: 'Colours', value: String(COLORS.length) },
                  { label: 'Radius', value: '0' },
                ]}
              />
              <Label seed="kit" sku="KIT-V1-2026" />
            </>
          }
        >
          <p>
            The pieces every page is built from. Each specimen is drawn twice — dark on the left, light on the right —
            straight from the same components the app uses.
          </p>
        </PageHero>

        {/* ---------------- principles ---------------- */}
        <KitSection index={1} title="Principles">
          <ol className="grid gap-px bg-rule border border-rule sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['The headline is the advice.', 'Every page opens by saying what to do, in the wide face, second line in outline.'],
              ['Lime means act or yours.', 'The accent fills buttons you press and rows that are you. Nothing decorative is lime.'],
              ['Labels are mono.', 'Section heads, meta and numbers in a column are JetBrains Mono, uppercase, tracked.'],
              ['Square and hairline.', 'No radius, no shadow on surfaces. Sections divide with 1px rules.'],
            ].map(([head, body], i) => (
              <li key={head} className="bg-ink p-4">
                <div className="figure text-[28px] text-signal leading-none mb-3">{String(i + 1).padStart(2, '0')}</div>
                <div className="wide uppercase text-[15px] mb-1.5">{head}</div>
                <p className="text-[13px] text-text-faint leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </KitSection>

        {/* ---------------- colour ---------------- */}
        <KitSection index={2} title="Colour" meta="CSS custom properties">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="font-mono text-[10px] tracking-[0.1em] text-text-faint text-left">
                  <th className="py-1.5 font-normal">TOKEN</th>
                  <th className="py-1.5 px-2 font-normal">DARK</th>
                  <th className="py-1.5 px-2 font-normal">LIGHT</th>
                  <th className="py-1.5 font-normal">USE</th>
                </tr>
              </thead>
              <tbody>
                {COLORS.map((c) => (
                  <tr key={c.token} className="border-t border-rule">
                    <td className="py-2.5">
                      <div className="font-bold [font-stretch:112%] uppercase text-[13px]">{c.name}</div>
                      <div className="num text-[11px] text-text-faint">{c.token}</div>
                    </td>
                    <td className="py-2.5 px-2">
                      <Swatch hex={c.dark} />
                    </td>
                    <td className="py-2.5 px-2">
                      <Swatch hex={c.light} />
                    </td>
                    <td className="py-2.5 text-[13px] text-text-dim">{c.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-5">
            <div className="h-16 border border-rule" style={{ background: 'var(--chrome)' }} />
            <div className="h-16 border border-rule" style={{ background: 'var(--holo)' }} />
            <div className="eyebrow">--chrome · the one figure a page is about</div>
            <div className="eyebrow">--holo · the sticker, nowhere else</div>
          </div>
        </KitSection>

        {/* ---------------- type ---------------- */}
        <KitSection index={3} title="Type" meta="Archivo (wdth 62–125) · JetBrains Mono">
          <Pair>
            <div className="space-y-5">
              <TypeRow name=".display" spec="Archivo 900 · 125% · uppercase · −0.04em">
                <div className="display text-[56px]">Bench Kittle.</div>
              </TypeRow>
              <TypeRow name=".outline-text" spec="2px stroke in --color-signal">
                <div className="display text-[56px] outline-text">Start McBride.</div>
              </TypeRow>
              <TypeRow name=".chrome-text .figure" spec="Archivo 900 · 125% · tabular">
                <div className="figure chrome-text text-[72px] leading-[0.9]">140.0</div>
              </TypeRow>
              <TypeRow name=".wide" spec="Archivo 800 · 112% — names, row titles">
                <div className="wide uppercase text-[18px]">Ladd McConkey</div>
              </TypeRow>
              <TypeRow name=".kicker" spec="Mono 700 · 12px · 0.16em">
                <div className="kicker">[01] The moves</div>
              </TypeRow>
              <TypeRow name=".eyebrow" spec="Mono 400 · 11px · 0.14em · faint">
                <div className="eyebrow">Projected / best lineup</div>
              </TypeRow>
              <TypeRow name="body" spec="Archivo 400 · 15–16px">
                <p className="text-[15px] text-text-dim leading-normal max-w-[420px]">
                  Kittle is ruled out and still in your lineup. Swap him and you&apos;re a 140-point team.
                </p>
              </TypeRow>
              <TypeRow name=".num" spec="Mono · tabular numerals">
                <div className="num text-[13px]">24.1 · 19.8 · 15.2 · 18.6</div>
              </TypeRow>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- buttons & fields ---------------- */}
        <KitSection index={4} title="Buttons and fields">
          <Pair>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary">
                  Open in Sleeper →
                </button>
                <button type="button" className="btn btn-solid">
                  Sync 09:42
                </button>
                <button type="button" className="btn btn-outline">
                  Build a trade →
                </button>
                <button type="button" className="btn btn-ghost">
                  Clear
                </button>
                <button type="button" className="btn btn-primary" disabled>
                  Disabled
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input className="field flex-1 min-w-[180px]" placeholder="YOUR SLEEPER HANDLE" aria-label="Sleeper username" />
                <select className="field uppercase" aria-label="League" defaultValue="a">
                  <option value="a">Gridiron Grumps / Wk 11</option>
                  <option value="b">Work League / Wk 11</option>
                </select>
              </div>
              <p className="eyebrow">.btn-primary · .btn-solid · .btn-outline · .btn-ghost · .field</p>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- tags ---------------- */}
        <KitSection index={5} title="Tags">
          <Pair>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <Tag tone="accent">New in</Tag>
                <Tag tone="solid">Trade</Tag>
                <Tag tone="outline">Superflex</Tag>
                <Tag tone="muted">Taxi</Tag>
                <Tag tone="crit">Out</Tag>
                <Tag tone="warn">Q</Tag>
                <Tag tone="fade">Drop</Tag>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDP', 'PICK'].map((p) => (
                  <PositionTag key={p} position={p} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <InjuryTag status="Out" playStatus="out" />
                <InjuryTag status="Questionable" playStatus="questionable" />
                <InjuryTag status="Doubtful" playStatus="doubtful" />
                <InjuryTag status={null} playStatus="bye" />
              </div>
              <p className="eyebrow">Tag · PositionTag · InjuryTag</p>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- figures ---------------- */}
        <KitSection index={6} title="Figures">
          <Pair>
            <div className="@container relative space-y-6">
              <ChromeFigure label="Projected / best lineup" value="140.0">
                NOW 123.5 <span className="text-signal">→ +16.5</span>
              </ChromeFigure>
              <Sticker value="+16.5" label="PTS FREE" className="absolute top-0 right-0" />
              <SpecGrid
                items={[
                  { label: 'Outlook', value: 'Contender' },
                  { label: 'Rank', value: '3 / 12' },
                  { label: 'Roster', value: '25 / 25' },
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <Stat label="FAAB left" value="$83" tone="signal" sub="of $100 budget" />
                <Stat label="Bench points" value="16.5" tone="warn" />
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <Trend value={310} />
                <Trend value={-60} />
                <MarketShift delta={1.8} />
                <MarketShift delta={-1.1} />
              </div>
              <Label seed="sample" sku="GG-W11-1400" />
              <p className="eyebrow">ChromeFigure · Sticker · SpecGrid · Stat · Trend · MarketShift · Label / Barcode</p>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- rows ---------------- */}
        <KitSection index={7} title="Rows and lists">
          <Pair>
            <div className="space-y-6">
              <ol className="flex flex-col gap-2.5">
                <ActionCard
                  index={1}
                  emphasis
                  title="McBride in. Kittle out."
                  detail="TE / Kittle ruled out — hamstring"
                  value="+13.4"
                  action={
                    <button type="button" className="btn btn-primary">
                      Open in Sleeper →
                    </button>
                  }
                />
                <ActionCard index={2} title="McConkey over Addison." detail="FLEX / projects 12.7 vs 9.6" value="+3.1" />
              </ol>
              <ol>
                {[
                  ['Lambeau Leapers', '152.4', false],
                  ['Gridiron Grumps (you)', '148.9', true],
                  ['Taco Corp', '131.0', false],
                ].map(([name, pts, mine], i) => (
                  <li
                    key={String(name)}
                    className={`flex items-center gap-2.5 py-2 px-2 border-t border-rule ${mine ? 'bg-accent text-on-accent' : ''}`}
                  >
                    <span className="figure text-[22px] w-[30px] leading-none">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1 font-bold [font-stretch:112%] uppercase text-[13px]">{name}</span>
                    <span className="font-mono text-[10px]">{pts}</span>
                  </li>
                ))}
              </ol>
              <div>
                <LeaderLine label="Active" value="25/25" />
                <LeaderLine label="Taxi" value="3/4" />
                <LeaderLine label="IR" value="1/2" />
              </div>
              <p className="eyebrow">ActionCard · leaderboard row · LeaderLine</p>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- containers ---------------- */}
        <KitSection index={8} title="Sections and panels">
          <Pair>
            <div className="space-y-6">
              <SectionHead index={2} title="Starting lineup — spec sheet" meta="8 / 8 slots" />
              <Panel index={3} title="Best available" meta="by position">
                <p className="px-4 py-4 text-[14px] text-text-faint">Boxed section for denser pages.</p>
              </Panel>
              <Panel index={1} title="Recommended moves" accent meta="ink frame = lead">
                <p className="px-4 py-4 text-[14px] text-text-faint">The `accent` frame marks the section to start with.</p>
              </Panel>
              <HowItWorks>
                <p>Explanations live behind this row instead of on screen.</p>
              </HowItWorks>
              <p className="eyebrow">Section / SectionHead · Panel · HowItWorks</p>
            </div>
          </Pair>
        </KitSection>

        {/* ---------------- page furniture ---------------- */}
        <KitSection index={9} title="Page furniture">
          <div className="space-y-6">
            <div className="border border-rule overflow-hidden">
              <DropStrip items={['Week 11 drop', '2 lineup changes inside', '+16.5 pts on the table']} />
            </div>
            <div className="border border-rule px-4">
              <PageHero
                kicker="[ Week 11 ] — Waiver board — dynasty"
                title={
                  <>
                    Add
                    <br />
                    <span className="outline-text">Nacua.</span>
                  </>
                }
              >
                <p>PageHero: kicker, headline with an outline second line, one line of plain explanation.</p>
              </PageHero>
            </div>
            <div className="border border-rule px-4">
              <EmptyState
                kicker="[ Draft ] — No draft yet"
                title={
                  <>
                    No draft.
                    <br />
                    <span className="outline-text">Yet.</span>
                  </>
                }
                action={
                  <button type="button" className="btn btn-primary">
                    Import from Sleeper →
                  </button>
                }
              >
                EmptyState: every page says what is missing and the one thing to do about it.
              </EmptyState>
            </div>
            <div className="flex items-end gap-6">
              <Barcode seed="cheatsheet" height={48} />
              <span className="eyebrow">Barcode seeds from league + week, so every drop prints its own.</span>
            </div>
          </div>
        </KitSection>
      </div>

      <SiteFooter />
    </main>
  );
}

function KitSection({ index, title, meta, children }: { index: number; title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="py-8 border-b border-rule">
      <SectionHead index={index} title={title} meta={meta} className="mb-5" />
      {children}
    </section>
  );
}

/** One specimen, drawn forced-dark and forced-light side by side. */
function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="grid lg:grid-cols-2 gap-px bg-rule border border-rule">
      {(['dark', 'light'] as const).map((theme) => (
        <div key={theme} data-theme={theme} className="bg-ink text-text p-5 sm:p-6 min-w-0">
          <div className="eyebrow mb-4">{theme}</div>
          {children}
        </div>
      ))}
    </div>
  );
}

function TypeRow({ name, spec, children }: { name: string; spec: string; children: ReactNode }) {
  return (
    <div className="border-t border-rule pt-3 min-w-0 overflow-hidden">
      <div className="flex flex-wrap justify-between gap-2 mb-2">
        <span className="num text-[11px] text-signal">{name}</span>
        <span className="eyebrow">{spec}</span>
      </div>
      {children}
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-6 h-6 border border-rule-bright shrink-0" style={{ background: hex }} />
      <span className="num text-[11px] text-text-dim">{hex}</span>
    </span>
  );
}
