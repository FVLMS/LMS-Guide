import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Buffer as BufferPolyfill } from 'buffer';
// Static imports to avoid dev-time dynamic import issues
import { PDFExporter, pdfDefaultSchemaMappings } from '@blocknote/xl-pdf-exporter';
import { Text, View, Image as PDFImage, Svg, Line, Path, pdf as pdfRenderer, Font } from '@react-pdf/renderer';
import { BlockNoteView } from '@blocknote/mantine';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react';
import { BlockNoteSchema, filterSuggestionItems } from '@blocknote/core';
import {
  withMultiColumn,
  getMultiColumnSlashMenuItems,
  multiColumnDropCursor,
  locales as multiColumnLocales,
} from '@blocknote/xl-multi-column';
import { AlertBlock } from './customBlocks/alert';
import { AnnotatedImageBlock } from './customBlocks/annotatedImage';
import { ImageWithConvertBlock } from './customBlocks/imageWithConvert';
// Inline CSS for export (flatten styles to avoid @import at runtime)
// These imports are only used when building the exported HTML string.
// Vite will inline them as strings thanks to the ?raw suffix.
import reactStylesCSS from '@blocknote/react/style.css?raw';
import coreStylesCSS from '@blocknote/core/style.css?raw';
import mantineStylesCSS from '@blocknote/mantine/style.css?raw';

type SaveFormat = 'json' | 'html' | 'mdx';

function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return s || 'untitled';
}

function download(name: string, type: string, data: string | Blob) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const DRAFT_KEY = 'bn_draft_v1';
const NAME_KEY  = 'bn_filename_v1';

export default function App() {
  if (!(globalThis as any).Buffer) {
    (globalThis as any).Buffer = BufferPolyfill;
  }
  const [fileName, setFileName] = useState<string>(() => localStorage.getItem(NAME_KEY) || 'untitled');
  const [dirty, setDirty] = useState<boolean>(false);
  const [pdfPreview, setPdfPreview] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressChangeRef = useRef<boolean>(false);
  

  // Enable multi‑column blocks by extending the schema,
  // and use the multi‑column drop cursor.
  const schema = useMemo(() => {
    const base = BlockNoteSchema.create();
    const withCustom = base.extend({ blockSpecs: { alert: AlertBlock(), annotated_image: AnnotatedImageBlock(), image: ImageWithConvertBlock() } });
    return withMultiColumn(withCustom);
  }, []);
  const editor = useCreateBlockNote({
    schema,
    dropCursor: multiColumnDropCursor,
    // Client-side image/file paste: store as data URL so no external hosting/CORS needed
    uploadFile: async (file: File) => {
      const toDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(f);
      });
      return await toDataUrl(file);
    },
  });

  const getSlashMenuItems = useCallback(async (query: string) => {
    const defaults = getDefaultReactSlashMenuItems(editor);
    const multi = getMultiColumnSlashMenuItems(editor);
    const extraActions: any[] = [];
    try {
      const cur = editor.getTextCursorPosition().block as any;
      if (cur?.type === 'image') {
        extraActions.push({
          title: 'Convert to Annotated Image',
          group: 'Basic blocks',
          onItemClick: () => {
            const src = cur.props?.url || '';
            const npw = cur.props?.previewWidth;
            const cap = cur.props?.caption || '';
            const name = cur.props?.name || '';
            const ta = cur.props?.textAlignment || 'left';
            const bg = cur.props?.backgroundColor || 'default';
            editor.replaceBlocks([cur], [{
              type: 'annotated_image',
              props: {
                url: src,
                previewWidth: npw,
                caption: cap,
                name,
                textAlignment: ta,
                backgroundColor: bg,
                showPreview: true,
                annotations: '[]',
              }
            } as any]);
          }
        });
      }
    } catch {}
    const callouts = [
      { title: 'Info Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'info' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Success Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'success' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Warning Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'warning' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Danger Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'danger' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Annotated Image', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'annotated_image', props: {} as any }], editor.getTextCursorPosition().block, 'after') },
      ...extraActions,
    ].map(i => ({ ...i, size: 'default' as const }));
    // Preserve the default group order (Headings, Subheadings, Basic blocks, ...)
    const groupOrder: string[] = [];
    for (const it of defaults) {
      if (it.group && groupOrder[groupOrder.length - 1] !== it.group) {
        groupOrder.push(it.group);
      }
    }
    const filtered = filterSuggestionItems([...defaults, ...multi, ...callouts as any], query);
    // Sort filtered items by the default group order so groups stay contiguous
    const orderIndex = (g?: string) => {
      const i = g ? groupOrder.indexOf(g) : -1;
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return filtered.slice().sort((a, b) => orderIndex(a.group) - orderIndex(b.group));
  }, [editor]);

  // Restore draft on first load
  useEffect(() => {
    // Ensure multi‑column dictionary is available.
    const anyEditor = editor as any;
    if (!anyEditor.dictionary?.multi_column) {
      anyEditor.dictionary = { ...(anyEditor.dictionary || {}), multi_column: multiColumnLocales.en };
    }
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      const should = confirm('Restore your previous local draft?');
      if (should) {
        try {
          const doc = JSON.parse(saved);
          const blocks = Array.isArray(doc) && doc.length > 0 ? doc : [{ type: 'paragraph' }];
          suppressChangeRef.current = true;
          const { insertedBlocks } = editor.replaceBlocks(editor.document, blocks);
          if (insertedBlocks?.[0]) {
            try { editor.setTextCursorPosition(insertedBlocks[0], 'start'); } catch {}
            try { editor.focus(); } catch {}
          }
          setDirty(true);
        } catch {}
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    // beforeunload guard
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle PDF width preview (A4 width minus 0.5in margins)
  useEffect(() => {
    const root = document.documentElement;
    if (pdfPreview) {
      try {
        document.body.classList.add('pdf-preview');
        // A4: 8.27in total width, 0.5in margins each side -> 7.27in content
        root.style.setProperty('--pdf-preview-width', '7.27in');
      } catch {}
    } else {
      try {
        document.body.classList.remove('pdf-preview');
        root.style.removeProperty('--pdf-preview-width');
      } catch {}
    }
    return () => {
      try { document.body.classList.remove('pdf-preview'); } catch {}
      try { root.style.removeProperty('--pdf-preview-width'); } catch {}
    };
  }, [pdfPreview]);

  // Keep NAME in localStorage
  useEffect(() => {
    localStorage.setItem(NAME_KEY, fileName);
  }, [fileName]);

  

  const onNew = () => {
    if (dirty && !confirm('Discard current local draft?')) return;
    // Replace with a single empty paragraph block (cannot be empty array).
    suppressChangeRef.current = true;
    const { insertedBlocks } = editor.replaceBlocks(editor.document, [{ type: 'paragraph' }]);
    if (insertedBlocks?.[0]) {
      try { editor.setTextCursorPosition(insertedBlocks[0], 'start'); } catch {}
      try { editor.focus(); } catch {}
    }
    localStorage.removeItem(DRAFT_KEY);
    setDirty(false);
    setFileName('untitled');
  };

  const onImportJSON = (file?: File) => {
    const f = file;
    if (!f) return;
    f.text().then(t => {
      try {
        const doc = JSON.parse(t);
        const blocks = Array.isArray(doc) && doc.length > 0 ? doc : [{ type: 'paragraph' }];
        suppressChangeRef.current = true;
        const { insertedBlocks } = editor.replaceBlocks(editor.document, blocks);
        if (insertedBlocks?.[0]) {
          try { editor.setTextCursorPosition(insertedBlocks[0], 'start'); } catch {}
          try { editor.focus(); } catch {}
        }
        const base = f.name.replace(/\.json$/i, '');
        setFileName(base);
        localStorage.setItem(DRAFT_KEY, JSON.stringify(blocks));
        setDirty(true);
      } catch {
        alert('Invalid JSON file.');
      }
    });
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const onExport = async (fmt: SaveFormat) => {
    const base = slugify(fileName);
    if (fmt === 'json') {
      const json = JSON.stringify(editor.document, null, 2);
      download(base + '.json', 'application/json', json);
      setDirty(false);
      return;
    }
    if (fmt === 'html') {
      let content = await editor.blocksToFullHTML(editor.document);
      // Ensure preview-sized images keep their pixel width in static HTML by
      // inlining a style when a width attribute is present.
      content = content.replace(/<img([^>]*?)>/g, (m, attrs) => {
        const w = attrs.match(/\bwidth=\"(\d+)\"/);
        if (!w) return m;
        if (/\bstyle=/.test(attrs)) return m;
        return `<img${attrs} style=\"width:${w[1]}px;height:auto\">`;
      });
      const stripImports = (css: string) => css.replace(/@import[^;]+;/g, '');
      const fullCss = [
        stripImports(coreStylesCSS),
        stripImports(reactStylesCSS),
        stripImports(mantineStylesCSS),
      ].join('\n');
      const doc = `<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n<title>${base}</title>\n<style>${fullCss}\nbody{margin:0;padding:24px;background:Canvas;color:CanvasText}</style>\n</head>\n<body>\n<div class=\"bn-container bn-default-styles\" data-color-scheme=\"light\">\n  <div class=\"bn-editor\">\n${content}\n  </div>\n</div>\n</body>\n</html>`;
      download(base + '.html', 'text/html;charset=utf-8', doc);
      setDirty(false);
      return;
    }
    if (fmt === 'mdx') {
      let html = await editor.blocksToFullHTML(editor.document);
      html = html.replace(/<img([^>]*?)>/g, (m, attrs) => {
        const w = attrs.match(/\bwidth=\"(\d+)\"/);
        if (!w) return m;
        if (/\bstyle=/.test(attrs)) return m;
        return `<img${attrs} style=\"width:${w[1]}px;height:auto\">`;
      });
      const frontmatter = `---\ntitle: "${base.replace(/"/g, '\"')}"\nupdated: "${new Date().toISOString().slice(0,10)}"\n---\n\n`;
      // Embed raw HTML directly; MDX allows raw HTML by default in Astro.
      const mdx = frontmatter + html + '\n';
      download(base + '.mdx', 'text/markdown;charset=utf-8', mdx);
      setDirty(false);
      return;
    }
    if (fmt === 'pdf') {

      // In some cases, users resize images in the editor but the JSON
      // doesn't yet have previewWidth. As a fallback, read the current
      // rendered width from the editor DOM and inject it into a shallow
      // copy of the document for export.
      const withMeasuredImageWidths = (blocks: any[]): any[] => {
        const map = (arr: any[]): any[] => arr.map((b) => {
          let next = b;
          if (b?.type === 'image' || b?.type === 'annotated_image') {
            const img = document.querySelector(`div[data-id="${b.id}"] img.bn-visual-media`) as HTMLImageElement | null;
            if (img) {
              const measured = Math.max(1, Math.round(img.getBoundingClientRect().width));
              next = { ...b, props: { ...b.props, previewWidth: measured } };
            }
          }
          if (b?.children?.length) {
            next = { ...next, children: map(b.children) };
          }
          return next;
        });
        return map(blocks);
      };

      const docForPdf = withMeasuredImageWidths(editor.document as any);
      // Compute a scale factor so that an image that is X px wide in the editor
      // becomes X * scale in the PDF, where scale maps the editor content width
      // to the PDF content width. This preserves relative sizing.
      const PIXELS_PER_POINT = 0.75;
      const A4_WIDTH_PT = 595.28;
      const pagePadHPt = (pdfDefaultSchemaMappings as any) ? ((new PDFExporter(editor.schema as any, pdfDefaultSchemaMappings) as any).styles?.page?.paddingHorizontal ?? 35) : 35;
      const pdfMaxWidthPt = A4_WIDTH_PT - 2 * pagePadHPt;
      const pdfMaxWidthPx = pdfMaxWidthPt / PIXELS_PER_POINT;
      const editorHost = (editor as any)?.domElement as HTMLElement | null;
      const editorContentEl = (editorHost?.firstElementChild || null) as HTMLElement | null;
      const editorWidthPx = editorContentEl?.clientWidth ?? editorHost?.clientWidth ?? document.body.clientWidth ?? 800;
      const pdfScalePx = Math.min(1, pdfMaxWidthPx / editorWidthPx);
      // Extend default mappings with an alert block mapping
      // Scale down font sizes to match editor density better
      const fontScale = 0.85; // Reduce by 15% to fit more content per page
      const pdfMappings = {
        blockMapping: {
          ...pdfDefaultSchemaMappings.blockMapping,
          alert: (block: any, _t: any) => {
            const color = ({info:'#0d6efd',success:'#198754',warning:'#ffc107',danger:'#dc3545'} as any)[block.props.variant || 'info'];
            return (
              <View key={'alert'+block.id} style={{ borderLeftColor: color, borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 6 }}>
                <Text>{_t.transformInlineContent(block.content)}</Text>
              </View>
            ) as any;
          },
          image: async (block: any, t: any) => {
            const pagePadH = (t.styles?.page?.paddingHorizontal ?? 35) * 1;
            const maxWidth = A4_WIDTH_PT - 2 * pagePadH;
            const desiredPx = block.props.previewWidth || null;
            const isFull = desiredPx ? (desiredPx >= editorWidthPx - 2) : false;
            const targetPx = isFull ? (maxWidth / PIXELS_PER_POINT) : (desiredPx ? desiredPx * pdfScalePx : (maxWidth / PIXELS_PER_POINT));
            const widthPt = Math.min(targetPx * PIXELS_PER_POINT, maxWidth);
            const actualWidth = widthPt;
            return (
              <View wrap={false} key={'image'+block.id}>
                <PDFImage src={await t.resolveFile(block.props.url)} style={{ width: actualWidth }} />
                {(() => {
                  const cap = block.props.caption as string | undefined;
                  return cap ? <Text style={{ fontSize: 10 }}>{cap}</Text> : null;
                })()}
              </View>
            ) as any;
          },
          annotated_image: async (block: any, t: any) => {
            const pagePadH = (t.styles?.page?.paddingHorizontal ?? 35) * 1;
            const maxWidth = A4_WIDTH_PT - 2 * pagePadH;
            const desiredPx = block.props.previewWidth || null;
            const isFull = desiredPx ? (desiredPx >= editorWidthPx - 2) : false;
            const targetPx = isFull ? (maxWidth / PIXELS_PER_POINT) : (desiredPx ? desiredPx * pdfScalePx : (maxWidth / PIXELS_PER_POINT));
            const widthPt = Math.min(targetPx * PIXELS_PER_POINT, maxWidth);
            const src = await t.resolveFile(block.props.url);
            // Determine aspect ratio by loading image in browser
            const { w: naturalW, h: naturalH } = await (async () => {
              return await new Promise<{ w: number; h: number }>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve({ w: (img as any).naturalWidth || (img as any).width, h: (img as any).naturalHeight || (img as any).height });
                img.onerror = () => resolve({ w: 1, h: 1 });
                img.src = src as any;
              });
            })();
            const heightPt = Math.max(1, widthPt * (naturalH / naturalW));
            // Parse annotations
            let annotations: any[] = [];
            try { annotations = JSON.parse(block.props.annotations || '[]'); } catch {}
            const lines = (annotations || []).filter((a) => a?.type === 'arrow');
            const dots = (annotations || []).filter((a) => a?.type === 'dot');
            return (
              <View wrap={false} key={'annotated_image'+block.id}>
                <View style={{ position: 'relative', width: widthPt }}>
                  <PDFImage src={src as any} style={{ width: widthPt }} />
                  <Svg width={widthPt} height={heightPt} style={{ position: 'absolute', left: 0, top: 0 }}>
                    {lines.map((a) => {
                      const x1 = (a.x || 0) * widthPt, y1 = (a.y || 0) * heightPt;
                      const x2 = (a.x2 || 0) * widthPt, y2 = (a.y2 || 0) * heightPt;
                      // arrow head as two short lines at the end
                      const angle = Math.atan2((y2 - y1), (x2 - x1));
                      const headLen = 8; // points
                      const leftAng = angle - Math.PI / 6;
                      const rightAng = angle + Math.PI / 6;
                      const lx = x2 - headLen * Math.cos(leftAng);
                      const ly = y2 - headLen * Math.sin(leftAng);
                      const rx = x2 - headLen * Math.cos(rightAng);
                      const ry = y2 - headLen * Math.sin(rightAng);
                      return (
                        <React.Fragment key={a.id}>
                          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ff7a00" strokeWidth={3} />
                          <Line x1={x2} y1={y2} x2={lx} y2={ly} stroke="#ff7a00" strokeWidth={3} />
                          <Line x1={x2} y1={y2} x2={rx} y2={ry} stroke="#ff7a00" strokeWidth={3} />
                        </React.Fragment>
                      );
                    })}
                    {dots.map((a) => {
                      const cx = (a.x || 0) * widthPt, cy = (a.y || 0) * heightPt;
                      const r = 5;
                      const d = `M ${cx + r},${cy} A ${r},${r} 0 1 0 ${cx - r},${cy} A ${r},${r} 0 1 0 ${cx + r},${cy}`;
                      return <Path key={a.id} d={d} fill="#ff7a00" />;
                    })}
                  </Svg>
                </View>
                {(() => {
                  const cap = block.props.caption as string | undefined;
                  return cap ? <Text style={{ fontSize: 10 }}>{cap}</Text> : null;
                })()}
              </View>
            ) as any;
          },
        },
        inlineContentMapping: pdfDefaultSchemaMappings.inlineContentMapping,
        styleMapping: {
          ...pdfDefaultSchemaMappings.styleMapping,
          // Override text styles to reduce font sizes
          text: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.text || {}),
            fontSize: 12 * fontScale,
          },
          h1: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.h1 || {}),
            fontSize: 24 * fontScale,
            marginTop: 8 * fontScale,
            marginBottom: 6 * fontScale,
          },
          h2: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.h2 || {}),
            fontSize: 20 * fontScale,
            marginTop: 7 * fontScale,
            marginBottom: 5 * fontScale,
          },
          h3: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.h3 || {}),
            fontSize: 16 * fontScale,
            marginTop: 6 * fontScale,
            marginBottom: 4 * fontScale,
          },
          paragraph: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.paragraph || {}),
            fontSize: 12 * fontScale,
            marginBottom: 4 * fontScale,
          },
          list: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.list || {}),
            fontSize: 12 * fontScale,
            marginBottom: 4 * fontScale,
          },
          listItem: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.listItem || {}),
            fontSize: 12 * fontScale,
            marginBottom: 2 * fontScale,
          },
          code: {
            ...((pdfDefaultSchemaMappings.styleMapping as any)?.code || {}),
            fontSize: 10 * fontScale,
          },
        },
      } as any;
      // Provide a conservative hyphenation callback to avoid overflow on extremely long words
      try {
        Font.registerHyphenationCallback((word: string) => {
          if (!word) return [word];
          // If the word already has hyphens or is small, leave it
          if (word.length <= 18 || /[-\u00AD]/.test(word)) return [word];
          // Otherwise break into chunks of ~12 characters to allow wrapping
          const size = 12;
          const parts: string[] = [];
          for (let i = 0; i < word.length; i += size) parts.push(word.slice(i, i + size));
          return parts;
        });
      } catch {}

      const exporter = new PDFExporter(editor.schema as any, pdfMappings, {
        // Avoid using the default BlockNote CORS proxy; keep data URLs inline,
        // and leave http(s) URLs unchanged (may fail if remote blocks CORS).
        resolveFileUrl: async (url: string) => url,
      } as any);
      // Keep default margins to maximize content width parity with editor
      const pdfDoc = await exporter.toReactPDFDocument(docForPdf as any);
      // In browser, render to Blob and download
      const instance = pdfRenderer(pdfDoc as any);
      const blob = await instance.toBlob();
      download(base + '.pdf', 'application/pdf', blob);
      setDirty(false);
      return;
    }
  };

  const onPrintExact = () => {
    try { document.body.classList.add('print-exact'); } catch {}
    const cleanup = () => {
      try { document.body.classList.remove('print-exact'); } catch {}
      window.removeEventListener('afterprint', cleanup as any);
    };
    window.addEventListener('afterprint', cleanup as any);
    try { window.print(); } catch { cleanup(); }
  };

  const clearLocal = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDirty(false);
  };

  return (
    <div>
      <div className="row" style={{gap: 8, margin: '12px 0'}}>
        <label>
          File name:&nbsp;
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="enter-title-here"
          />
        </label>
        <button onClick={onNew} title="Start a new, empty document">New</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportJSON(f);
            e.currentTarget.value = '';
          }}
        />
        <button onClick={triggerImport}>Import JSON</button>
      <span className="spacer" />
        
        <button className="primary" onClick={() => onExport('json')}>Export JSON</button>
        <button onClick={() => onExport('html')}>Export HTML</button>
        <button onClick={() => onExport('mdx')}>Export MDX</button>
        <button onClick={() => onExport('pdf')}>Export PDF</button>
        <button onClick={onPrintExact} title="Use your browser's print-to-PDF for exact layout">Print PDF (Exact)</button>
        <button onClick={() => setPdfPreview(p => !p)} title="Constrain editor to printable width">
          {pdfPreview ? 'Preview Width: On' : 'Preview Width: Off'}
        </button>
        <button onClick={clearLocal} title="Remove the autosaved local draft">Clear Local Draft</button>
      </div>

      <div className="tips" style={{marginBottom: 8}}>
        Tip: we autosave to your browser’s local storage. Export JSON/HTML/MDX to publish or share.
      </div>

      <div className="editor">
        <BlockNoteView
          editor={editor}
          slashMenu={false}
          onChange={() => {
            if (suppressChangeRef.current) {
              suppressChangeRef.current = false;
            } else {
              try {
                const json = JSON.stringify(editor.document);
                localStorage.setItem(DRAFT_KEY, json);
                localStorage.setItem(NAME_KEY, fileName);
              } catch {}
              setDirty(true);
            }
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getSlashMenuItems}
          />
        </BlockNoteView>
      </div>

      <div className="footer">
        <p>
          This is a client‑side editor. Nothing is uploaded until you export and commit files to your docs repo.
        </p>
      </div>
    </div>
  );
}
