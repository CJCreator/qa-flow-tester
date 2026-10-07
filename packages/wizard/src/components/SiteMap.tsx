import React, { useMemo, useState, useEffect } from 'react';
import type { DiscoveredFlow } from '@qa/types';
import { journeyPages } from '@qa/types/src/site-map.js';

export interface PageNode {
  ref: string; // e.g. "pg-01"
  urlPath: string;
  title: string;
  journeys: Array<{ id: string; index: number }>;
  status?: 'pending' | 'running' | 'pass' | 'warn' | 'fail';
  issuesCount?: number;
}

export interface PageGroup {
  id: string;
  label: string;
  count: number;
  pages: string[];
}

/** A page on the map: the plan's pages, or a report's. */
export interface MapPage {
  urlPath: string;
  title?: string;
}

/** A journey on the map: a planned one (its pages come from its steps), or a report's (pages listed). */
export type MapJourney = { id: string; name?: string; pages: string[] };

export type PageStatus = { status: 'pass' | 'warn' | 'fail'; issuesCount?: number };

export interface SiteMapProps {
  pages: MapPage[];
  /** The plan's journeys. */
  flows?: DiscoveredFlow[];
  /** A report's journeys, with their pages already listed. Used instead of `flows` when given. */
  journeys?: MapJourney[];
  mode: 'plan' | 'live' | 'report';
  selectedPagePath?: string | null;
  runningPagePath?: string | null;
  pageStatuses?: Record<string, PageStatus>;
  onSelectPage?: (urlPath: string) => void;
  /** The site's real links between pages (the App Flow), drawn beneath the journeys. */
  links?: Array<{ from: string; to: string }>;
  /** Pages drawn as cards before the rest are grouped. Default 6. */
  maxCards?: number;
}

const JOURNEY_COLORS = ['#B69CFB', '#6FB0FA', '#4ADE9A', '#F59AC6', '#FBA35C'];

/** Phones get the list: the drawing is wider than their screen. */
function startsAsList(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
  );
}

const STATUS_WORDS: Record<NonNullable<PageNode['status']>, string> = {
  pending: 'Not tested on its own',
  running: 'Being tested now',
  pass: 'No problems',
  warn: 'Minor problems',
  fail: 'Serious problems',
};

function statusText(node: PageNode): string {
  if (node.status === 'warn' || node.status === 'fail') {
    return `${node.issuesCount ?? 0} ${node.issuesCount === 1 ? 'problem' : 'problems'}`;
  }
  return STATUS_WORDS[node.status ?? 'pending'];
}

export function SiteMap({
  pages,
  flows = [],
  journeys: givenJourneys,
  mode,
  selectedPagePath,
  runningPagePath,
  pageStatuses,
  onSelectPage,
  links,
  maxCards = 6,
}: SiteMapProps) {
  const [viewMode, setViewMode] = useState<'map' | 'list'>(() => (startsAsList() ? 'list' : 'map'));
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [connectorPaths, setConnectorPaths] = useState<Array<{ id: string; d: string; color: string }>>([]);
  const [linkPaths, setLinkPaths] = useState<Array<{ id: string; d: string }>>([]);

  // One shape for both kinds of journey: an id and its pages in order.
  const journeys: MapJourney[] = useMemo(
    () => givenJourneys ?? flows.map((f) => ({ id: f.id, name: f.name, pages: journeyPages(f) })),
    [givenJourneys, flows]
  );
  const colorOf = (index: number) => JOURNEY_COLORS[index % JOURNEY_COLORS.length];

  const { nodes, groups } = useMemo(() => {
    const onJourney = new Map<string, Array<{ id: string; index: number }>>();
    journeys.forEach((journey, i) => {
      for (const page of journey.pages) {
        const list = onJourney.get(page) || [];
        if (!list.some((j) => j.id === journey.id)) list.push({ id: journey.id, index: i });
        onJourney.set(page, list);
      }
    });

    const nodeList: PageNode[] = [];
    const otherPages: MapPage[] = [];
    for (const p of pages) {
      if (onJourney.has(p.urlPath) || p.urlPath === '/' || nodeList.length < maxCards) {
        const known = pageStatuses?.[p.urlPath];
        nodeList.push({
          ref: `pg-${String(nodeList.length + 1).padStart(2, '0')}`,
          urlPath: p.urlPath,
          title: p.title || p.urlPath,
          journeys: onJourney.get(p.urlPath) || [],
          status: runningPagePath === p.urlPath ? 'running' : (known?.status ?? 'pending'),
          issuesCount: known?.issuesCount ?? 0,
        });
      } else {
        otherPages.push(p);
      }
    }

    // The rest, grouped by the first part of their address.
    const byPrefix = new Map<string, string[]>();
    for (const p of otherPages) {
      const first = p.urlPath.split('/').filter(Boolean)[0];
      const prefix = first ? `/${first}` : '/other';
      byPrefix.set(prefix, [...(byPrefix.get(prefix) || []), p.urlPath]);
    }
    const groupList: PageGroup[] = [...byPrefix.entries()].map(([prefix, list]) => ({
      id: prefix,
      label: prefix === '/other' ? 'Other pages' : `Pages under ${prefix}`,
      count: list.length,
      pages: list,
    }));
    return { nodes: nodeList, groups: groupList };
  }, [pages, journeys, runningPagePath, pageStatuses, maxCards]);

  // Where each card sits on the drawing.
  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; width: number; height: number }>();
    const cardWidth = 160;
    const cardHeight = 110;
    nodes.forEach((node, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      pos.set(node.urlPath, {
        x: 60 + col * (cardWidth + 80),
        y: 80 + row * (cardHeight + 50) + (col % 2 === 1 ? 30 : 0),
        width: cardWidth,
        height: cardHeight,
      });
    });
    return pos;
  }, [nodes]);
  const groupsTop = 80 + Math.ceil(nodes.length / 4) * 160 + 40;

  useEffect(() => {
    if (viewMode !== 'map') return;
    const paths: Array<{ id: string; d: string; color: string }> = [];
    journeys.forEach((journey, index) => {
      for (let i = 0; i < journey.pages.length - 1; i++) {
        const from = nodePositions.get(journey.pages[i]);
        const to = nodePositions.get(journey.pages[i + 1]);
        if (!from || !to) continue;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const dx = Math.max(Math.abs(x2 - x1) * 0.5, 30);
        paths.push({
          id: `${journey.id}-${i}`,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          color: colorOf(index),
        });
      }
    });
    setConnectorPaths(paths);

    // The site's own links between the pages on the drawing, once per pair.
    const seen = new Set<string>();
    const drawn: Array<{ id: string; d: string }> = [];
    for (const link of links || []) {
      const key = [link.from, link.to].sort().join('↔');
      const from = nodePositions.get(link.from);
      const to = nodePositions.get(link.to);
      if (!from || !to || link.from === link.to || seen.has(key)) continue;
      seen.add(key);
      const x1 = from.x + from.width / 2;
      const y1 = from.y + from.height;
      const x2 = to.x + to.width / 2;
      const y2 = to.y;
      drawn.push({ id: key, d: `M ${x1} ${y1} C ${x1} ${y1 + 40}, ${x2} ${y2 - 40}, ${x2} ${y2}` });
    }
    setLinkPaths(drawn);
  }, [journeys, nodePositions, viewMode, links]);

  const showStatus = mode !== 'plan';
  const pageCount = pages.length;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-panel/80 px-4 py-2 text-xs">
        <p className="text-ink-soft">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {journeys.length}{' '}
          {journeys.length === 1 ? 'journey' : 'journeys'}
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="How to show the map">
          {(
            [
              ['map', 'Map'],
              ['list', 'List'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              aria-pressed={viewMode === id}
              className={`min-h-[44px] min-w-[44px] rounded px-3 py-1 font-bold transition-colors ${
                viewMode === id ? 'bg-stamp text-surface' : 'text-ink-soft hover:bg-surface hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {showStatus && (
        <ul
          aria-label="What the colours mean"
          className="flex flex-wrap gap-x-4 gap-y-1 border-b border-rule bg-panel/60 px-4 py-1.5 text-xs text-ink-soft"
        >
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-pass" /> Tested, no problems
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-warn" /> Minor problems
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-fail" /> Serious problems
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-rule" />{' '}
            {mode === 'live' ? 'Not reached yet' : 'Not tested on its own'}
          </li>
        </ul>
      )}

      {viewMode === 'list' ? (
        <div className="w-full flex-1 overflow-y-auto p-4 sm:p-6">
          <ul className="mx-auto max-w-4xl space-y-2">
            {nodes.map((node) => (
              <li key={node.urlPath}>
                <button
                  type="button"
                  onClick={() => onSelectPage?.(node.urlPath)}
                  aria-pressed={selectedPagePath === node.urlPath}
                  aria-label={`${node.title}, ${node.urlPath}${showStatus ? `: ${statusText(node)}` : ''}`}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border-2 p-3 text-left transition-colors ${
                    selectedPagePath === node.urlPath
                      ? 'border-stamp bg-surface'
                      : 'border-rule bg-surface/50 hover:border-edge'
                  }`}
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-ink">{node.title}</strong>
                    <span className="block truncate font-mono text-xs text-ink-soft">{node.urlPath}</span>
                  </span>
                  {showStatus && <PageStatusLabel node={node} />}
                </button>
              </li>
            ))}
          </ul>
          {groups.map((group) => (
            <details key={group.id} className="mx-auto mt-3 max-w-4xl rounded-md border border-rule">
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-ink">
                {group.label} · {group.count} {group.count === 1 ? 'page' : 'pages'}
              </summary>
              <ul className="space-y-1 p-3">
                {group.pages.map((page) => (
                  <li key={page}>
                    <button
                      type="button"
                      onClick={() => onSelectPage?.(page)}
                      className="min-h-[44px] w-full rounded px-2 text-left font-mono text-xs text-ink-soft hover:bg-surface hover:text-ink"
                    >
                      {page}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        // The drawing is a fixed size and scrolls inside the map, never the page.
        <div className="relative min-h-0 flex-1 overflow-auto bg-canvas">
          <div
            className="relative p-8"
            style={{
              backgroundImage: `
                linear-gradient(rgba(91,141,239,0.08) 1px, transparent 1px),
                linear-gradient(to right, rgba(91,141,239,0.08) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              minHeight: `${Math.max(620, groupsTop + Math.ceil(groups.length / 3) * 110)}px`,
              minWidth: '960px',
            }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              {linkPaths.map((p) => (
                <path
                  key={p.id}
                  d={p.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-rule"
                  strokeOpacity={0.9}
                />
              ))}
              {connectorPaths.map((p) => (
                <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeOpacity={0.9} />
              ))}
            </svg>

            {nodes.map((node) => {
              const pos = nodePositions.get(node.urlPath) || { x: 40, y: 40, width: 160, height: 110 };
              const isSelected = selectedPagePath === node.urlPath;
              const border =
                node.status === 'pass'
                  ? 'border-l-4 border-l-pass'
                  : node.status === 'warn'
                    ? 'border-l-4 border-l-warn'
                    : node.status === 'fail'
                      ? 'border-l-4 border-l-fail'
                      : '';
              return (
                <button
                  key={node.urlPath}
                  type="button"
                  onClick={() => onSelectPage?.(node.urlPath)}
                  aria-pressed={isSelected}
                  aria-label={`${node.title}, ${node.urlPath}${showStatus ? `: ${statusText(node)}` : ''}`}
                  style={{ position: 'absolute', left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.width}px` }}
                  className={`rounded-md border border-rule bg-surface/95 text-left shadow-md transition-colors hover:border-stamp ${border} ${
                    isSelected ? 'ring-2 ring-stamp' : ''
                  } ${node.status === 'running' ? 'animate-pulse ring-2 ring-stamp motion-reduce:animate-none' : ''}`}
                >
                  <span className="flex items-center justify-between border-b border-rule/50 px-2.5 py-1.5 font-mono text-xs text-ink-soft">
                    <span aria-hidden="true">{node.ref}</span>
                    <span className="max-w-[100px] truncate">{node.urlPath}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="relative mx-2 my-1.5 block aspect-video overflow-hidden rounded border border-rule/30 bg-canvas/70 p-1.5"
                  >
                    <span className="mb-1 block h-1 w-2/3 rounded-sm bg-rule" />
                    <span className="mb-1 block h-3 w-full rounded bg-stamp/10" />
                    <span className="block h-1 w-1/2 rounded-sm bg-rule/70" />
                  </span>
                  <span className="flex items-center justify-between gap-1 px-2.5 pb-2 pt-0.5">
                    <span className="truncate text-xs font-bold text-ink">{node.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {showStatus && node.status !== 'pending' && node.status !== 'running' ? (
                        <PageStatusLabel node={node} compact />
                      ) : (
                        node.journeys.map((j) => (
                          <span
                            key={j.id}
                            aria-hidden="true"
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: colorOf(j.index) }}
                          />
                        ))
                      )}
                    </span>
                  </span>
                </button>
              );
            })}

            {groups.map((group, idx) => (
              <div
                key={group.id}
                style={{
                  position: 'absolute',
                  left: `${60 + (idx % 3) * 240}px`,
                  top: `${groupsTop + Math.floor(idx / 3) * 110}px`,
                  width: '200px',
                }}
              >
                <button
                  type="button"
                  aria-expanded={openGroup === group.id}
                  onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
                  className="w-full rounded-md border border-dashed border-rule bg-surface/40 p-3 text-center transition-colors hover:border-stamp hover:bg-surface/70"
                >
                  <span className="block text-xs font-bold text-ink">{group.label}</span>
                  <span className="block font-mono text-xs text-ink-soft">
                    {group.count} {group.count === 1 ? 'page' : 'pages'}
                  </span>
                </button>
                {openGroup === group.id && (
                  <ul className="relative z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-rule bg-surface p-1 shadow-lg">
                    {group.pages.map((page) => (
                      <li key={page}>
                        <button
                          type="button"
                          onClick={() => onSelectPage?.(page)}
                          className="min-h-[44px] w-full truncate rounded px-2 text-left font-mono text-xs text-ink-soft hover:bg-canvas hover:text-ink"
                        >
                          {page}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PageStatusLabel({ node, compact = false }: { node: PageNode; compact?: boolean }) {
  const tone =
    node.status === 'fail'
      ? 'text-fail'
      : node.status === 'warn'
        ? 'text-warn'
        : node.status === 'pass'
          ? 'text-pass'
          : node.status === 'running'
            ? 'text-stamp'
            : 'text-ink-soft';
  const mark =
    node.status === 'fail'
      ? '✕'
      : node.status === 'warn'
        ? '!'
        : node.status === 'pass'
          ? '✓'
          : node.status === 'running'
            ? '●'
            : '–';
  return (
    <span className={`shrink-0 font-mono ${compact ? 'text-xs' : 'text-xs'} font-bold ${tone}`}>
      <span aria-hidden="true">{mark} </span>
      {compact && (node.status === 'warn' || node.status === 'fail') ? node.issuesCount : statusText(node)}
    </span>
  );
}
