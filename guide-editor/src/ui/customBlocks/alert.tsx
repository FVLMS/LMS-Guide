import { createReactBlockSpec } from '@blocknote/react';
import type { PropSchema } from '@blocknote/core';
import React from 'react';

type Variant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_COLORS: Record<Variant, { bg: string; border: string }> = {
  info: { bg: 'rgba(13,110,253,0.08)', border: '#0d6efd' },
  success: { bg: 'rgba(25,135,84,0.10)', border: '#198754' },
  warning: { bg: 'rgba(255,193,7,0.12)', border: '#ffc107' },
  danger: { bg: 'rgba(220,53,69,0.12)', border: '#dc3545' },
};

export const AlertBlock = createReactBlockSpec(
  {
    type: 'alert',
    content: 'inline',
    propSchema: {
      variant: { default: 'info', values: ['info', 'success', 'warning', 'danger'] as const },
      title: { default: '' },
    } satisfies PropSchema,
    isFileBlock: false,
  },
  {
    render: ({ block, contentRef }) => {
      const v = (block.props.variant || 'info') as Variant;
      const c = VARIANT_COLORS[v];
      return (
        <div
          className="bn-alert-block"
          style={{
            display: 'flex',
            gap: 12,
            padding: '10px 12px',
            background: c.bg,
            borderLeft: `4px solid ${c.border}`,
            borderRadius: 6,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {block.props.title && (
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{block.props.title}</div>
            )}
            <div ref={contentRef} />
          </div>
        </div>
      );
    },
  }
);
