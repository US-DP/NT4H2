/**
 * Mock de @shopify/flash-list — renderiza los items como FlatList
 * para que los tests encuentren los textos.
 */

import React from 'react';

export const FlashList = (props: any) => {
  const { data, renderItem, ListEmptyComponent, keyExtractor } = props;
  const items = (data ?? []).map((item: any, i: number) =>
    React.createElement(
      React.Fragment,
      { key: keyExtractor?.(item) ?? i },
      renderItem({ item, index: i, target: 'Cell' }),
    ),
  );
  if (items.length === 0 && ListEmptyComponent) {
    items.push(React.createElement(React.Fragment, { key: 'empty' }, ListEmptyComponent));
  }
  return React.createElement('FlashList', props, items);
};
