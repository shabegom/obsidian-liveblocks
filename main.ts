import "dotenv/config.js";
import { Plugin } from "obsidian";
import { createClient } from "@liveblocks/client";
import {
  Decoration,
  DecorationSet,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

export default class LiveBlocks extends Plugin {
  users: { presence?: { offset?: number } }[] = [];
  async onload() {
    // get an API key from liveblocks.io
    const client = createClient({
      publicApiKey: process.env.API_KEY,
    })
    const room = client.enter("liveblocks-test");
    let text: string;
    // get the object from storageblock
    const { root } = await room.getStorage();

    // just a basic example of subscribing to update to block storage
    room.subscribe(root, (updates) => {
      console.log(updates.toObject());
      const object: { source?: string } = updates.toObject();
      if (object.source) {
        text = object.source;
        console.log(text);
      } else {
        text = "add some text";
      }
    });

    // subscribe to presence updates and store them in this.users
    room.subscribe("others", (others) => {
      console.log(Array.from(others));
      this.users = Array.from(others);
    });

    // listen to editor change events and update a user's presence with their cursor position
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        const cursor = editor.getCursor();
        const offset = editor.posToOffset(cursor);
        room.updatePresence({ offset });
      }),
    );

    // the editor extension creates the cursor decoration
    this.registerEditorExtension(cursorPlugin(this));

    // basic example of how you could update a storage block and present the presence inside a note.
    // In reality you wouldn't limit this to a codeblock, but it is a simple example.
    this.registerMarkdownCodeBlockProcessor("liveblock", async (source, el) => {
      // update the storage block with the contents of the codeblock
      root.update({ source });
      
      // putting the number of users into the render output of the codeblock
      const div = document.createElement("div");
      const present = document.createElement("div");
      room.subscribe("others", (others) => {
        if (others.count === 0) {
          present.innerHTML = "You're the only one here.";
        } else if (others.count === 1) {
          present.innerHTML = "There is one other person here.";
        } else {
          present.innerHTML = "There are " + others.count +
            " other people here.";
        }
      });
      div.appendChild(present);
      el.appendChild(div);
    });
  }
}

// probably better to do a mark decoration, but I could only get widgets to work
class CursorWidget extends WidgetType {
  constructor() {
    super();
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-cursor";
    wrap.innerText = "|";
    return wrap;
  }
}

// add a widget at the cursor position stored in the user's presence
function cursor(plugin: LiveBlocks) {
  const widgets = [];
  const users = plugin.users.sort((a, b) => {
    if (a.presence && b.presence && a.presence.offset > b.presence.offset) {
      return 1;
    } else {
      return 0;
    }
  });
  for (const { presence } of users) {
    if (presence && presence.offset) {
      const { offset } = presence;
      const deco = Decoration.widget({
        widget: new CursorWidget(),
        side: 1,
      });
      widgets.push(deco.range(offset));
    }
  }
  return Decoration.set(widgets);
}

const cursorPlugin = (plugin: LiveBlocks) => {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor() {
        this.decorations = cursor(plugin);
      }

      update() {
        this.decorations = cursor(plugin);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
};
