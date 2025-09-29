import React, { useState } from 'react';
import { createImageBlockConfig, imageParse } from '@blocknote/core';
import { createReactBlockSpec, useResolveUrl } from '@blocknote/react';
import { ResizableFileBlockWrapper, ImageToExternalHTML } from '@blocknote/react';

const MyImagePreview = (props: any) => {
  const resolved = useResolveUrl(props.block.props.url!);
  const src = resolved.loadingState === 'loading' ? props.block.props.url : resolved.downloadUrl;
  return (
    <img
      className="bn-visual-media"
      src={src}
      alt={props.block.props.caption || 'BlockNote image'}
      contentEditable={false}
      draggable={false}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    />
  );
};

export const ImageWithConvertBlock = createReactBlockSpec(
  createImageBlockConfig,
  (config) => ({
    render: (props: any) => {
      const [hovered, setHovered] = useState(false);
      const onConvert = () => {
        const p = props.block.props || {};
        (props.editor as any).replaceBlocks([props.block], [{
          type: 'annotated_image',
          props: {
            url: p.url || '',
            previewWidth: p.previewWidth,
            caption: p.caption || '',
            name: p.name || '',
            textAlignment: p.textAlignment || 'left',
            backgroundColor: p.backgroundColor || 'default',
            showPreview: true,
            annotations: '[]',
          },
        }]);
      };
      return (
        <ResizableFileBlockWrapper
          {...(props as any)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div style={{ position: 'relative' }}>
            <MyImagePreview {...(props as any)} />
            <div style={{ position: 'absolute', right: 6, top: 6, display: hovered ? 'flex' : 'flex', zIndex: 1000 }}>
              <button className="bn-convert-btn" onClick={onConvert} style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: 'white', border: '1px solid rgba(255,255,255,0.6)' }}>Convert</button>
            </div>
          </div>
        </ResizableFileBlockWrapper>
      );
    },
    parse: imageParse(config),
    toExternalHTML: ImageToExternalHTML as any,
  }),
);
