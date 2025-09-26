import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  const [fileName, setFileName] = useState<string>(() => localStorage.getItem(NAME_KEY) || 'untitled');
  const [dirty, setDirty] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressChangeRef = useRef<boolean>(false);
  

  // Enable multi‑column blocks by extending the schema,
  // and use the multi‑column drop cursor.
  const schema = useMemo(() => {
    const base = BlockNoteSchema.create();
    const withAlert = base.extend({ blockSpecs: { alert: AlertBlock() } });
    return withMultiColumn(withAlert);
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
    const callouts = [
      { title: 'Info Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'info' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Success Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'success' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Warning Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'warning' } }], editor.getTextCursorPosition().block, 'after') },
      { title: 'Danger Alert', group: 'Basic blocks', onItemClick: () => editor.insertBlocks([{ type: 'alert', props: { variant: 'danger' } }], editor.getTextCursorPosition().block, 'after') },
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
      const content = await editor.blocksToFullHTML(editor.document);
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
      const html = await editor.blocksToFullHTML(editor.document);
      const frontmatter = `---\ntitle: "${base.replace(/"/g, '\"')}"\nupdated: "${new Date().toISOString().slice(0,10)}"\n---\n\n`;
      // Embed raw HTML directly; MDX allows raw HTML by default in Astro.
      const mdx = frontmatter + html + '\n';
      download(base + '.mdx', 'text/markdown;charset=utf-8', mdx);
      setDirty(false);
      return;
    }
    if (fmt === 'pdf') {
      const { PDFExporter, pdfDefaultSchemaMappings } = await import('@blocknote/xl-pdf-exporter');
      const { Text, View } = await import('@react-pdf/renderer');
      const ReactPDF = await import('@react-pdf/renderer');
      // Extend default mappings with an alert block mapping
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
        },
        inlineContentMapping: pdfDefaultSchemaMappings.inlineContentMapping,
        styleMapping: pdfDefaultSchemaMappings.styleMapping,
      } as any;
      const exporter = new PDFExporter(editor.schema as any, pdfMappings, {
        // Avoid using the default BlockNote CORS proxy; keep data URLs inline,
        // and leave http(s) URLs unchanged (may fail if remote blocks CORS).
        resolveFileUrl: async (url: string) => url,
      } as any);
      // Double the left/right margin (paddingHorizontal is both left & right)
      const currentPH: any = (exporter.styles.page as any).paddingHorizontal ?? 35;
      (exporter.styles.page as any).paddingHorizontal = currentPH * 2;
      const pdfDoc = await exporter.toReactPDFDocument(editor.document as any);
      // In browser, render to Blob and download
      const instance = ReactPDF.pdf(pdfDoc as any);
      const blob = await instance.toBlob();
      download(base + '.pdf', 'application/pdf', blob);
      setDirty(false);
      return;
    }
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
