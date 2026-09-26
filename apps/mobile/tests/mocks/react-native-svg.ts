/** Mock de react-native-svg — stubs de componentes. */

import React from 'react';

function stub(name: string) {
  const C = (props: any) => React.createElement(name, props, props.children);
  C.displayName = name;
  return C;
}

export const Svg = stub('Svg');
export const Path = stub('Path');
export const Circle = stub('Circle');
export const Rect = stub('Rect');
export const G = stub('G');
export const Line = stub('Line');
export const Polyline = stub('Polyline');
export const Polygon = stub('Polygon');
export default Svg;
