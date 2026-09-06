import { useState } from 'react';
import { DeckSession } from '../modules/deck/DeckSession';
import { fixtureDeck, fixturePaper } from '../../tests/fixtures';
import { Editor } from './editor/Editor';

const placeholder = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#e8eef2"/><text x="300" y="250" font-size="40" fill="#39718c">Figure 3</text></svg>')}`;
const image = async () => placeholder;
export default function FixturePage() {
  const [session] = useState(() => new DeckSession(fixtureDeck, fixturePaper));
  return (
    <Editor
      session={session}
      name="smartJC fixture"
      paper={fixturePaper}
      image={image}
      onExport={async (deck) => {
        const { exportDeck, downloadDeck } = await import('../modules/deck/export');
        downloadDeck(await exportDeck(deck, fixturePaper, image), 'smartJC-fixture');
      }}
    />
  );
}
