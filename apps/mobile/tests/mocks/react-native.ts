/**
 * Mock de react-native para tests.
 * Proporciona componentes mínimos que permiten renderizar.
 */

import React from 'react';

function makeComponent(name: string) {
  const Comp = React.forwardRef((props: any, ref: any) => {
    return React.createElement(name, { ...props, ref }, props.children);
  });
  Comp.displayName = name;
  return Comp;
}

export const View = makeComponent('View');
export const Text = makeComponent('Text');
export const Pressable = makeComponent('Pressable');
export const ScrollView = makeComponent('ScrollView');
export const TextInput = makeComponent('TextInput');
export const Image = makeComponent('Image');
export const FlatList = makeComponent('FlatList');
export const Modal = makeComponent('Modal');
export const SafeAreaView = makeComponent('SafeAreaView');
export const StatusBar = makeComponent('StatusBar');
export const ActivityIndicator = makeComponent('ActivityIndicator');
export const Switch = makeComponent('Switch');
export const TouchableOpacity = makeComponent('TouchableOpacity');
export const TouchableHighlight = makeComponent('TouchableHighlight');
export const TouchableWithoutFeedback = makeComponent('TouchableWithoutFeedback');
export const StyleSheet = {
  create: (styles: Record<string, any>) => styles,
  flatten: (style: any) => style,
};
export const Platform = { OS: 'web' as const, select: (obj: any) => obj.web || obj.default };
export const Dimensions = { get: () => ({ width: 375, height: 812 }) };
export const Animated = {
  View: makeComponent('Animated.View'),
  Value: class { },
  timing: () => ({ start: () => { } }),
  spring: () => ({ start: () => { } }),
};
export const Easing = { linear: () => ({}), ease: () => ({}) };
export const PanResponder = { create: () => ({ panHandlers: {} }) };
