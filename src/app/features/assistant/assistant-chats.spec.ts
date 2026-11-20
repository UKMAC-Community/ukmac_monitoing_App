import { TestBed } from '@angular/core/testing';

import { Assistant, type Turn } from './assistant';

const turn = (question: string): Turn => ({
  question,
  answer: 'An answer',
  seconds: 1,
  rag: { understood: [], sources: [], queries: [{ title: 'Count', call: 'count()', sources: [], sql: 'sql', lines: Array.from({ length: 80 }, (_, index) => `line ${index}`), rows: 80 }], context: 'a lot of text', notes: [], records: 0, found: true, direct: null, carry: { sheet: null, filters: [], kinds: [] } },
});

describe('the chat history', () => {
  beforeEach(() => localStorage.removeItem('ukmac.chats.v1'));

  function make() {
    TestBed.resetTestingModule();
    return TestBed.inject(Assistant);
  }

  it('starts a chat with the first question and adds the next to it', () => {
    const assistant = make();
    expect(assistant.turns(1)).toEqual([]);
    assistant.addTurn(1, turn('How many plots are in each zone?'));
    assistant.addTurn(1, turn('And in zone B?'));
    expect(assistant.chatsOf(1)).toHaveLength(1);
    expect(assistant.chatsOf(1)[0].title).toBe('How many plots are in each zone?');
    expect(assistant.turns(1)).toHaveLength(2);
  });

  it('a new chat is separate, and an older chat can be opened again', () => {
    const assistant = make();
    assistant.addTurn(1, turn('First'));
    const first = assistant.activeId(1)!;
    assistant.newChat(1);
    expect(assistant.turns(1)).toEqual([]);
    assistant.addTurn(1, turn('Second'));
    expect(assistant.chatsOf(1)).toHaveLength(2);
    assistant.select(1, first);
    expect(assistant.turns(1)[0].question).toBe('First');
  });

  it('each MAC has its own chats', () => {
    const assistant = make();
    assistant.addTurn(1, turn('One'));
    assistant.addTurn(2, turn('Two'));
    expect(assistant.chatsOf(1).map((chat) => chat.title)).toEqual(['One']);
    expect(assistant.chatsOf(2).map((chat) => chat.title)).toEqual(['Two']);
  });

  it('deleting the open chat opens a new one', () => {
    const assistant = make();
    assistant.addTurn(1, turn('One'));
    assistant.deleteChat(1, assistant.activeId(1)!);
    expect(assistant.chatsOf(1)).toEqual([]);
    expect(assistant.activeId(1)).toBeNull();
  });

  it('is kept on this computer, without the text handed to the model and with long results cut', () => {
    make().addTurn(1, turn('Kept'));
    const again = make();
    const kept = again.chatsOf(1)[0];
    expect(kept.title).toBe('Kept');
    expect(kept.turns[0].rag.context).toBe('');
    expect(kept.turns[0].rag.queries[0].lines).toHaveLength(40);
  });

  it('a long first question gives a short title', () => {
    const assistant = make();
    assistant.addTurn(1, turn('x'.repeat(100)));
    expect(assistant.chatsOf(1)[0].title).toHaveLength(48);
  });
});
