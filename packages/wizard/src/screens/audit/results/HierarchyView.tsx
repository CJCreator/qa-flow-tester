import type { HierarchyNode, PageHierarchy } from '@qa/types/src/browser.js';
import { LINK_REGIONS, LINK_REGION_LABEL, PLACED_BY_LABEL, textLangAttrs, titleText } from './analysis-text';

export interface HierarchyViewProps {
  hierarchy: PageHierarchy;
}

/** The tree with every page kept to its first place, so a page is listed once even if the data repeats it. */
function withoutRepeats(node: HierarchyNode, seen: Set<string> = new Set([node.urlPath])): HierarchyNode {
  const children = node.children.filter((child) => {
    if (seen.has(child.urlPath)) return false;
    seen.add(child.urlPath);
    return true;
  });
  return { ...node, children: children.map((child) => withoutRepeats(child, seen)) };
}

/** One page and the pages beneath it. */
function PageItem({ node }: { node: HierarchyNode }) {
  const children = node.children;
  const hasTitle = node.title !== null && node.title.trim() !== '';
  return (
    <li className="mt-1">
      <span className="font-bold text-ink" {...(hasTitle ? textLangAttrs(node.title ?? '', 'not-identified') : {})}>
        {hasTitle ? node.title : node.urlPath}
      </span>
      {hasTitle && <span className="ml-2 break-all text-sm text-ink-soft">{node.urlPath}</span>}
      {!hasTitle && <span className="ml-2 text-sm text-ink-soft">({titleText(node.title)})</span>}
      <span className="ml-2 text-xs text-ink-soft">{PLACED_BY_LABEL[node.placedBy]}</span>
      {children.length > 0 && (
        <ul className="ml-4 border-l border-rule pl-3">
          {children.map((child) => (
            <PageItem key={child.urlPath} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The page hierarchy as a nested list and the navigation map grouped by where each link sits (REQ-007). */
export function HierarchyView({ hierarchy }: HierarchyViewProps) {
  const root = withoutRepeats(hierarchy.root);
  return (
    <section aria-labelledby="audit-hierarchy-title" className="space-y-4">
      <h2 id="audit-hierarchy-title" className="text-xl font-bold">
        Page hierarchy
      </h2>
      <ul aria-label="Page hierarchy">
        <PageItem node={root} />
      </ul>

      <h3 className="text-lg font-bold">Navigation map</h3>
      {hierarchy.links.length === 0 && <p className="text-sm text-ink-soft">No internal links were found.</p>}
      {LINK_REGIONS.map((region) => {
        const links = hierarchy.links.filter((link) => link.region === region);
        if (links.length === 0) return null;
        const label = LINK_REGION_LABEL[region];
        return (
          <div key={region} className="space-y-2">
            <h4 className="font-bold">{label}</h4>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{`${label}: ${links.length} ${links.length === 1 ? 'link' : 'links'}`}</caption>
              <thead>
                <tr>
                  <th scope="col">On page</th>
                  <th scope="col">Link text</th>
                  <th scope="col">Goes to</th>
                  <th scope="col">Where it sits</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link, i) => (
                  <tr key={`${link.from}-${link.to}-${i}`}>
                    <td className="break-all">{link.from}</td>
                    <td>{link.text.trim() === '' ? 'No link text' : link.text}</td>
                    <td className="break-all">{link.to}</td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
