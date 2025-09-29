import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import type { PropSchema } from '@blocknote/core';
import { ResizableFileBlockWrapper, useResolveUrl } from '@blocknote/react';

type AnnType = 'dot' | 'arrow';
type Annotation = {
  id: string;
  type: AnnType;
  x: number; // 0..1
  y: number; // 0..1
  x2?: number; // for arrow
  y2?: number; // for arrow
};

function parseAnnotations(s: string | undefined): Annotation[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a === 'object') : [];
  } catch {
    return [];
  }
}

function stringifyAnnotations(a: Annotation[]): string {
  return JSON.stringify(a);
}

// Simple uid
const uid = () => Math.random().toString(36).slice(2, 9);

// Rendered only when a URL is present; safe to resolve URL here
function AnnotatedImagePreview(props: any) {
  const resolved = useResolveUrl(props.block.props.url!);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = useState(false);
  const anns = useMemo(() => parseAnnotations(props.block.props.annotations as any), [props.block.props.annotations]);
  const setAnns = useCallback((next: Annotation[]) => {
    (props.editor as any).updateBlock(props.block, { props: { annotations: stringifyAnnotations(next) } });
  }, [props.editor, props.block]);

  const addDot = useCallback(() => {
    const next: Annotation = { id: uid(), type: 'dot', x: 0.5, y: 0.5 };
    setAnns([...(anns || []), next]);
  }, [anns, setAnns]);
  const addArrow = useCallback(() => {
    const next: Annotation = { id: uid(), type: 'arrow', x: 0.3, y: 0.5, x2: 0.7, y2: 0.5 };
    setAnns([...(anns || []), next]);
  }, [anns, setAnns]);

  const dragRef = useRef<{ id: string; endpoint?: 1 | 2 } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const clamped = (n: number) => Math.max(0, Math.min(1, n));
      const i = anns.findIndex((a) => a.id === dragRef.current!.id);
      if (i === -1) return;
      const a = { ...(anns[i]) } as Annotation;
      if (a.type === 'dot') {
        a.x = clamped(x); a.y = clamped(y);
      } else {
        if (dragRef.current!.endpoint === 1) { a.x = clamped(x); a.y = clamped(y); }
        else { a.x2 = clamped(x); a.y2 = clamped(y); }
      }
      const next = anns.slice(); next[i] = a;
      setAnns(next);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [anns, setAnns]);

  const startDrag = (id: string, endpoint?: 1 | 2) => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { id, endpoint };
  };

  const removeAnn = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setAnns((anns || []).filter((a) => a.id !== id));
  };

  const src = resolved.loadingState === 'loading' ? props.block.props.url : resolved.downloadUrl;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <img
        ref={imgRef}
        className="bn-visual-media"
        src={src}
        alt={props.block.props.caption || 'Annotated image'}
        contentEditable={false}
        draggable={false}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
      <div className="bn-annot-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {anns.filter(a => a.type === 'arrow').map((a: Annotation) => {
            const x1 = (a.x || 0) * 100, y1 = (a.y || 0) * 100;
            const x2 = (a.x2 || 0) * 100, y2 = (a.y2 || 0) * 100;
            const angle = Math.atan2((a.y2! - a.y!), (a.x2! - a.x!));
            const len = 2.2; const aw = 1.2;
            const ax = x2, ay = y2;
            const bx = x2 - len * Math.cos(angle) + aw * Math.sin(angle);
            const by = y2 - len * Math.sin(angle) - aw * Math.cos(angle);
            const cx = x2 - len * Math.cos(angle) - aw * Math.sin(angle);
            const cy = y2 - len * Math.sin(angle) + aw * Math.cos(angle);
            return (
              <g key={a.id} style={{ pointerEvents: 'none' }}>
                <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke="#ff7a00" strokeWidth={3} />
                <polygon points={`${ax},${ay} ${bx},${by} ${cx},${cy}`} fill="#ff7a00" />
              </g>
            );
          })}
        </svg>
        {anns.map((a: Annotation) => {
          if (a.type === 'dot') {
            return (
              <div key={a.id} style={{ position: 'absolute', left: `${(a.x || 0) * 100}%`, top: `${(a.y || 0) * 100}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}>
                <div onMouseDown={startDrag(a.id)} title="Drag to move. Shift+Click to delete" onClick={(e) => { if (e.shiftKey) removeAnn(a.id)(e); }} style={{ width: 14, height: 14, borderRadius: 999, background: '#ff7a00', border: '2px solid white', boxShadow: '0 0 0 1px #ff7a00' }} />
              </div>
            );
          }
          return (
            <React.Fragment key={a.id}>
              <div style={{ position: 'absolute', left: `${(a.x || 0) * 100}%`, top: `${(a.y || 0) * 100}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}>
                <div onMouseDown={startDrag(a.id, 1)} title="Drag arrow start" style={{ width: 12, height: 12, borderRadius: 999, background: '#ff7a00', border: '2px solid white', boxShadow: '0 0 0 1px #ff7a00', cursor: 'grab' }} />
              </div>
              <div style={{ position: 'absolute', left: `${(a.x2 || 0) * 100}%`, top: `${(a.y2 || 0) * 100}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}>
                <div onMouseDown={startDrag(a.id, 2)} title="Drag arrow end (shift+click to delete)" onClick={(e) => { if (e.shiftKey) removeAnn(a.id)(e); }} style={{ width: 12, height: 12, borderRadius: 2, background: '#ff7a00', border: '2px solid white', boxShadow: '0 0 0 1px #ff7a00', transform: 'translate(-50%, -50%) rotate(45deg)', cursor: 'grab' }} />
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ position: 'absolute', right: 6, top: 6, display: hovered ? 'flex' : 'none', gap: 6, background: 'rgba(0,0,0,0.45)', color: 'white', padding: '3px 6px', borderRadius: 6 }}>
        <button onClick={addDot} style={{ fontSize: 12 }}>+ Dot</button>
        <button onClick={addArrow} style={{ fontSize: 12 }}>+ Arrow</button>
      </div>
    </div>
  );
}

export const AnnotatedImageBlock = createReactBlockSpec(
  {
    type: 'annotated_image',
    content: 'none',
    isFileBlock: true,
    propSchema: {
      textAlignment: { default: 'left', values: ['left', 'center', 'right', 'justify'] as const },
      backgroundColor: { default: 'default' },
      name: { default: '' },
      url: { default: '' },
      caption: { default: '' },
      showPreview: { default: true },
      previewWidth: { default: undefined, type: 'number' },
      annotations: { default: '[]', type: 'string' },
    } satisfies PropSchema,
  },
  {
    render: (props) => {
      return (
        <ResizableFileBlockWrapper {...(props as any)}>
          {props.block.props.url ? <AnnotatedImagePreview {...(props as any)} /> : null}
        </ResizableFileBlockWrapper>
      );
    },
    toExternalHTML: (props) => {
      if (!props.block.props.url) {
        return <p>Add image</p> as any;
      }
      const anns = parseAnnotations(props.block.props.annotations as any);
      const image = (
        <img
          src={props.block.props.url}
          alt={props.block.props.name || props.block.props.caption || 'Annotated image'}
          width={props.block.props.previewWidth as any}
        />
      );
      const overlay = (
        <div style={{ position: 'absolute', inset: 0 }}>
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {anns.filter(a => a.type === 'arrow').map((a) => {
              const x1 = (a.x || 0) * 100, y1 = (a.y || 0) * 100;
              const x2 = (a.x2 || 0) * 100, y2 = (a.y2 || 0) * 100;
              const angle = Math.atan2((a.y2! - a.y!), (a.x2! - a.x!));
              const len = 2.2; const aw = 1.2;
              const ax = x2, ay = y2;
              const bx = x2 - len * Math.cos(angle) + aw * Math.sin(angle);
              const by = y2 - len * Math.sin(angle) - aw * Math.cos(angle);
              const cx = x2 - len * Math.cos(angle) - aw * Math.sin(angle);
              const cy = y2 - len * Math.sin(angle) + aw * Math.cos(angle);
              return (
                <g key={a.id}>
                  <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke="#ff7a00" strokeWidth={3} />
                  <polygon points={`${ax},${ay} ${bx},${by} ${cx},${cy}`} fill="#ff7a00" />
                </g>
              );
            })}
          </svg>
          {anns.filter(a => a.type === 'dot').map((a) => (
            <div key={a.id} style={{ position: 'absolute', left: `${(a.x || 0) * 100}%`, top: `${(a.y || 0) * 100}%`, transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: 999, background: '#ff7a00', border: '2px solid white', boxShadow: '0 0 0 1px #ff7a00' }} />
          ))}
        </div>
      );
      const content = (
        <figure style={{ position: 'relative', display: 'inline-block', margin: 0 }}>
          {image}
          {overlay}
          {props.block.props.caption && (
            <figcaption>{props.block.props.caption}</figcaption>
          )}
        </figure>
      );
      return content as any;
    },
  }
);

export type { Annotation };
