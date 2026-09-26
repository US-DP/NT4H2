/**
 * Mock de moti para tests: los componentes animados son los nativos.
 */

import { View, Text, ScrollView, Image } from 'react-native';

export const MotiView = View;
export const MotiText = Text;
export const MotiScrollView = ScrollView;
export const MotiImage = Image;
export const useAnimationState = () => ({ current: 'initial', transitionTo: () => {} });
export const AnimatePresence = ({ children }: { children?: React.ReactNode }) => children;
export const View_ = View;
