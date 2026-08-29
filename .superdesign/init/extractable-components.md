# Extractable Components

## AppShell

- Source: `src/client/App.tsx`
- Category: layout
- Description: Responsive sidebar/topbar shell with desktop navigation, mobile bottom navigation, global actions, and view composition.
- Extractable props: `activeView` (`"overview" | "costs" | "table"`), `showToast` (boolean), `showAddCost` (boolean)
- Hardcoded: Stackfolio wordmark, AS monogram, navigation labels/icons, portfolio link, privacy copy, sign-out and add-cost actions.

## StatCard

- Source: `src/client/components/Dashboard.tsx`
- Category: basic
- Description: Compact portfolio metric with label, icon, value, comparison note, and color tone.
- Extractable props: `label`, `value`, `note`, `tone`
- Hardcoded: icon geometry comes from Lucide; CSS selector family in `src/client/styles.css`.

## ItemDrawer

- Source: `src/client/components/ItemDrawer.tsx`
- Category: layout
- Description: Right-side cost detail surface with metrics, actions, chart, metadata, and ledger history.
- Extractable props: `isOpen` (boolean), `status` (`active | closed`), `showEntryForm` (boolean), `selectedYear` (number)
- Hardcoded: section labels, Lucide icons, action labels, and ledger structure.

## AddCostModal

- Source: `src/client/components/AddCostModal.tsx`
- Category: layout
- Description: Responsive cost creation dialog with dynamic device field and sticky mobile actions.
- Extractable props: `isOpen` (boolean), `category`, `billingType`, `submitting` (boolean)
- Hardcoded: field labels, option labels, Lucide icon, and action copy.
