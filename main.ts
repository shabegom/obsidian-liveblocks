import { Editor, Plugin } from "obsidian";
import { Client, createClient, LiveObject, Room, } from "@liveblocks/client";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
  Update,
} from "@codemirror/collab";
import { RangeSetBuilder } from "@codemirror/rangeset";

export default class LiveBlocks extends Plugin {
  users: { presence?: { offset?: number } }[] = [];
  presence = "Loading Presence...";
  room: Room;
  client: Client;
  updates: Record<string, { updates: Update[] }>
  pending: ((value: number) => Promise<Update[]>)[] = [];
  unsubscribe: () => void;
  async onload() {
    // get an API key from liveblocks.io
    this.client = createClient({
      publicApiKey: process.env.API_KEY,
    });
    this.room = this.client.enter("liveblocks-test-4");
    console.log("connected to room");

    // get the object from storageblock
    const { root } = await this.room.getStorage();
    const files = this.app.vault
      .getFiles()
      .reduce((acc: Record<string, { updates: Update[] }>, file) => {
        acc[file.name] = {
          updates: [],
        };
        return acc;
      }, {});
    root.update({ files });
    console.log("set this.state");
    this.updates = files;
    console.log("set this.updates");

    // subscribe to presence updates and store them in this.users
    this.unsubscribe = this.room.subscribe("others", (others) => {
      console.log("presence: ", Array.from(others));
      this.users = Array.from(others);
      if (others.count === 0) {
        this.presence = "You're the only one here.";
      } else if (others.count === 1) {
        this.presence = "There is one other person here.";
      } else {
        this.presence = "There are " + others.count + " other people here.";
      }
    });

    // listen to editor change events and update a user's presence with their cursor position
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        const file = this.app.workspace.getActiveFile();
        const cursor = editor.getCursor();
        const offset = editor.posToOffset(cursor);
        this.room.updatePresence({ file: file.name, offset });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateObject: any = root.toObject();
        console.log(stateObject);
        if (stateObject.files) {
          const updates = stateObject.files[file.name].updates;
          console.log("updating this.updates with changes", updates);
          this.updates[file.name].updates.push(...updates);
        }
      }),
    );


    // the editor extension creates the cursor decoration
    this.registerEditorExtension([cursorsPlugin(this), liveblocksPlugin(this, root)]);

    // basic example of how you could update a storage block and present the presence inside a note.
    // In reality you wouldn't limit this to a codeblock, but it is a simple example.
    this.registerMarkdownCodeBlockProcessor(
      "liveblock",
      async (_source, el) => {
        // putting the number of users into the render output of the codeblock
        const div = document.createElement("div");
        div.innerText = this.presence;
        el.appendChild(div);
      },
    );
  }
  onunload() {
    this.unsubscribe();
    this.client.leave("liveblocks-test");
  }
}

// add a widget at the cursor position stored in the user's presence
function cursor(plugin: LiveBlocks) {
  const builder = new RangeSetBuilder<Decoration>();
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
      const deco = Decoration.mark({
        class: "cm-live-cursor",
      });
      builder.add(offset - 1, offset, deco);
    }
  }
  return builder.finish();
}

const cursorsPlugin = (plugin: LiveBlocks) => {
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

const liveblocksPlugin = (plugin: LiveBlocks, root: LiveObject) => {
  const lbPlugin = ViewPlugin.fromClass(
    class {
      private pushing = false;
      private done = false;

      constructor(private view: EditorView) {
            console.log("going to pull changes");
            this.pull();
      }

      async update(update: ViewUpdate) {
        if (update.docChanged) {
          const updates = sendableUpdates(this.view.state);
          if (this.pushing || !updates.length) return;
          this.pushing = true;
          const version = getSyncedVersion(this.view.state);
          await pushUpdates(version, updates, plugin, root);
          this.pushing = false;
        }
      }

      async pull() {
        while (!this.done) {
          const file = plugin.app.workspace.getActiveFile().name;
          const version = getSyncedVersion(this.view.state);
          console.log("pulling updates");
          let updates = await pullUpdates(
            version,
            plugin.updates[file].updates,
            plugin.pending
          );
          if (!updates && plugin.pending[0]) {
            updates = await plugin.pending.pop()(version)
          }
          console.log("dispatching");
          this.view.dispatch(receiveUpdates(this.view.state, updates));
        }
      }

      destroy() {
        this.done = true;
      }
    },
  );
  return [collab(), lbPlugin];
};

function pullUpdates(version: number, updates: Update[], pending: ((value: number) => Promise<Update[]>)[]): Promise<Update[]> {
  console.log("in pullUpdates", version, updates);
  if (updates[0] && version < updates.length) {
    console.log("pulling updates");
    return new Promise((resolve) => {
      resolve(
        updates.slice(version).map((u) => ({
          changes: u.changes,
          clientID: u.clientID,
        })),
      );
    });
  } else if (updates[0]) {
    console.log("sending to pending")
    pending.push((nextVersion) => pullUpdates(nextVersion, updates, pending))
  }
}

async function pushUpdates(
  version: number,
  fullUpdates: readonly Update[],
  plugin: LiveBlocks,
  root: LiveObject,
): Promise<boolean> {
  console.log("in push");
  const file = plugin.app.workspace.getActiveFile();
  const files: Record<string, { updates: Update[]; doc: Editor }> =
    root.toObject().files;
  const updates = fullUpdates.map((update) => {
    return {
      changes: update.changes,
      clientID: update.clientID,
    };
  });
  files[file.name].updates.push(...updates);
  console.log("are they equal?",version, updates);
  if (updates && version != updates.length) {
    return false;
  } else {
    console.log("pushing updates");
    console.log(files);
    root.update({files});
    console.log("push success");
    return true;
  }
}
