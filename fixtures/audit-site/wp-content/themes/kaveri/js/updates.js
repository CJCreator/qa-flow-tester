/* global document */
// Builds the updates list in the browser: none of this text, and not the link, is in the page's HTML.
(function renderUpdates() {
  const list = document.getElementById('updates-list');
  if (!list) return;
  const updates = [
    'Diwali gift boxes are ready: order before 28 October for delivery anywhere in Chennai.',
    'Fresh Mysore pak and jangiri every morning from 8 am during the festival week.',
  ];
  for (const text of updates) {
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  }
  const more = document.createElement('p');
  const link = document.createElement('a');
  link.href = '/updates/festival-hours';
  link.textContent = 'See our festival opening hours';
  more.appendChild(link);
  list.after(more);
  document.getElementById('updates-status').textContent = 'Updated for Diwali 2025.';
})();
