/**
 * Mock de @gorhom/bottom-sheet para tests.
 * La hoja no se renderiza (present/dismiss son no-ops en refs nulos).
 */

import { forwardRef } from 'react';
import { View, ScrollView } from 'react-native';

export const BottomSheetModal = forwardRef((_props: unknown, _ref: unknown) => null);
export const BottomSheetView = View;
export const BottomSheetScrollView = ScrollView;
export const BottomSheetBackdrop = () => null;
export const BottomSheetModalProvider = ({ children }: { children?: React.ReactNode }) => children;
export const useBottomSheetModal = () => ({ dismiss: () => {}, dismissAll: () => {} });
export const useBottomSheet = () => ({ expand: () => {}, close: () => {} });
export const SCREEN_HEIGHT = 0;
export const SHEET_STATE = { CLOSED: 0 };
