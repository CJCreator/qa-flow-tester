import { sectionText, type PageContent } from '@qa/types/src/browser.js';
import {
  ALT_DECORATIVE,
  ALT_MISSING,
  FORMS_NOTE,
  LEAVES_SITE,
  LINK_REGION_LABEL,
  NO_TEXT,
  SECTION_KIND_LABEL,
  TEXT_TRUNCATED,
  declaredLanguageText,
  descriptionText,
  otherLanguagesText,
  primaryLanguageText,
  textLangAttrs,
  titleText,
} from './analysis-text';

export interface PageContentViewProps {
  content: PageContent;
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}

/** One page's Page Content: what the Website Audit read from it, Section by Section (REQ-008, REQ-009, REQ-013). */
export function PageContentView({ content }: PageContentViewProps) {
  const primary = content.language.primary;
  /** lang and dir for page text, so Tamil and the other listed scripts are marked as written. */
  const as = (text: string | null) => (text === null ? {} : textLangAttrs(text, primary));

  return (
    <article aria-labelledby="page-content-title" className="space-y-4">
      <h2 id="page-content-title" className="text-xl font-bold">
        Page Content <span className="break-all text-base font-normal text-ink-soft">{content.urlPath}</span>
      </h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-bold">Title</dt>
        <dd {...as(content.title)}>{titleText(content.title)}</dd>
        <dt className="font-bold">Description</dt>
        <dd {...as(content.description)}>{descriptionText(content.description)}</dd>
        <dt className="font-bold">Language</dt>
        <dd>{primaryLanguageText(content.language)}</dd>
        <dt className="font-bold">Other languages</dt>
        <dd>{otherLanguagesText(content.language)}</dd>
        <dt className="font-bold">lang attribute</dt>
        <dd>{declaredLanguageText(content.language)}</dd>
      </dl>

      <h3 className="text-lg font-bold">Sections</h3>
      {content.textTruncated && <p className="text-sm text-ink-soft">{TEXT_TRUNCATED}</p>}
      {content.sections.length === 0 ? (
        <Empty>No Sections were found.</Empty>
      ) : (
        <ol className="space-y-3">
          {content.sections.map((section) => {
            const text = sectionText(content, section);
            const heading = section.heading?.trim() ? section.heading : SECTION_KIND_LABEL[section.kind];
            return (
              <li key={section.id} className="rounded-card border border-rule p-3">
                <h4 className="font-bold" {...(section.heading ? as(section.heading) : {})}>
                  {heading}
                </h4>
                <p className="text-xs text-ink-soft">{`Section ${section.id} · ${SECTION_KIND_LABEL[section.kind]}`}</p>
                {text.trim() === '' ? (
                  <Empty>{NO_TEXT}</Empty>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink" {...as(text)}>
                    {text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <h3 className="text-lg font-bold">Headings</h3>
      {content.headings.length === 0 ? (
        <Empty>No headings were found.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Heading text</th>
              </tr>
            </thead>
            <tbody>
              {content.headings.map((heading, i) => (
                <tr key={i}>
                  <td>{`H${heading.level}`}</td>
                  <td {...as(heading.text)}>{heading.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="text-lg font-bold">Images</h3>
      {content.images.length === 0 ? (
        <Empty>No images were found.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th scope="col">Image address</th>
                <th scope="col">Alt text</th>
              </tr>
            </thead>
            <tbody>
              {content.images.map((image, i) => (
                <tr key={i}>
                  <td className="break-all">{image.src}</td>
                  {image.alt === null ? (
                    <td className="font-bold">{ALT_MISSING}</td>
                  ) : image.alt === '' ? (
                    <td className="text-ink-soft">{ALT_DECORATIVE}</td>
                  ) : (
                    <td {...as(image.alt)}>{image.alt}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="text-lg font-bold">Links</h3>
      {content.links.length === 0 ? (
        <Empty>No links were found.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th scope="col">Link text</th>
                <th scope="col">Goes to</th>
                <th scope="col">Where it sits</th>
              </tr>
            </thead>
            <tbody>
              {content.links.map((link, i) => (
                <tr key={i}>
                  <td {...as(link.text)}>{link.text.trim() === '' ? 'No link text' : link.text}</td>
                  <td className="break-all">
                    {link.to}
                    {link.leavesSite && <span className="ml-2 text-xs text-ink-soft">{LEAVES_SITE}</span>}
                  </td>
                  <td>{LINK_REGION_LABEL[link.region]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="text-lg font-bold">Forms</h3>
      <p className="text-sm text-ink-soft">{FORMS_NOTE}</p>
      {content.forms.length === 0 ? (
        <Empty>No forms were found.</Empty>
      ) : (
        <ol className="space-y-3">
          {content.forms.map((form, i) => (
            <li key={i} className="space-y-1">
              <h4 className="font-bold">{`Form ${i + 1}`}</h4>
              <p className="text-xs text-ink-soft">
                {`Method ${form.method.toUpperCase()} · would send to ${form.action ?? 'this page'}`}
              </p>
              {form.fields.length === 0 ? (
                <Empty>No fields.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-plain">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Type</th>
                        <th scope="col">Name</th>
                        <th scope="col">Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.fields.map((field, j) => (
                        <tr key={j}>
                          <td {...as(field.label)}>{field.label.trim() === '' ? 'No label' : field.label}</td>
                          <td>{field.type}</td>
                          <td>{field.name ?? 'Not set'}</td>
                          <td>{field.required ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <h3 className="text-lg font-bold">Calls to action</h3>
      {content.ctas.length === 0 ? (
        <Empty>No calls to action were found.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th scope="col">Text</th>
                <th scope="col">Kind</th>
                <th scope="col">Goes to</th>
              </tr>
            </thead>
            <tbody>
              {content.ctas.map((cta, i) => (
                <tr key={i}>
                  <td {...as(cta.text)}>{cta.text.trim() === '' ? 'No text' : cta.text}</td>
                  <td>{cta.kind === 'button' ? 'Button' : 'Button-styled link'}</td>
                  <td className="break-all">{cta.to ?? 'No target'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
