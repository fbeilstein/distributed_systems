Project Goal: Build a deterministic, interactive Distributed Systems Sandbox in vanilla JavaScript (or minimal framework) that pairs a discrete-event simulation engine with a reactive, horizontal space-time diagram. No back-end, JS only solution. Should be able to host that on github.io. The UI must feel tactile and instantly reactive; any modification to the timeline must instantly recompute and redraw the visual state of the entire system.


2. Screen Layout & Visuals
- Top Half (The Timeline Canvas): A horizontally scrolling area where the X-axis represents Time (ticks).
- Server Tracks: Each server has a dedicated, horizontal line spanning the X-axis.
- Message Arrows: Messages sent between servers are drawn as arrows originating from the sender's track at the "send time" and pointing to the receiver's track at the "arrival time". User should be able to drag arrow end thus change arrival time. User should NOT be able to make arrival time earlier than send time. Hovering on arrows should make visible a small window that shows message details.
- The Scrubber: A highly visible, draggable vertical line spanning the height of the canvas, representing the "Current Time".
- Bottom Half (State Inspector): A row of cleanly formatted UI cards, one for each server in the cluster. These cards display the live, stringified JSON dictionary of that server's internal state.

3. Core Interactions
The application must support the following direct-manipulation interactions:
- Time Travel (The Scrubber): As the user drags the vertical Scrubber left or right across the timeline, the JSON state cards in the bottom half must update to show exactly what each server's internal dictionary looked like at that exact tick.
- Manipulating Network Latency (Draggable Arrows): The arrowhead (arrival point) of any message must have a draggable handle.
  + Users can drag the arrowhead horizontally along the receiver's track to delay or speed up a message.
  + Constraint: An arrowhead can never be dragged to the left of its origin point (a message cannot arrive before it was sent).
  + Reactivity: Dropping the arrowhead instantly recalculates the simulation from that point forward, redrawing any subsequent arrows. Users can drag multiple arrowheads to the exact same X-coordinate to test simultaneous arrival/tie-breakers.
- Message Loss: Double-clicking an arrow toggles its state to "Lost." The arrow should visually fade out, turn dashed, or turn red, and the engine must instantly recalculate the future as if that message never arrived. Another double-click should change its state back to normal and recalculate things.
- Server Crashes & Recoveries: Double-clicking a server's horizontal track at a specific point in time toggles the server's power state. Clicking anoher point makes server again "up" at that point.
  + Visuals: The track should turn gray or dashed from that point forward to indicate downtime.
  + Behavior: Any message arrows landing in a "down" zone are ignored by the server. Double-clicking further down the track revives it.
- Adding and removing servers: we should have a + button to add new server at the beginning of the simulation and to remove existing servers.
- Code editing: double-click on on servers in State Inspector should call a small window with code editor for current server.


4. Authoring & Configuration
- Code Injection: The logic for the servers is provided by the user via standard JavaScript functions (onUp, onTimer, onMessage).
  + onUp called when staring server, may be initial start or recovery after being down
  + onMessage(message) called on arrival of "arrow" - message, message is a dictionary with data sent from another server
  + onTimer(tick) called every tick if server is up, gets tick number
  + user has access to functions: loadState(), dumpState(state), sendMessage(server, message)
    * loadState() returns a dictionary that represents state dumped to disk on server. This is the state shown in State Inspector for the server
    * dumpState(state) saves state, it is shown in State Inspector, this state can be recovered after being down
    * sendMessage(server, message) spawns an arrow from current track to server. 
- Live Editing: Double-clicking a server's State Inspector card (bottom half) opens a lightweight code editor modal. Saving the code instantly restarts the simulation with the new logic.
- Topology Controls: The UI must include buttons to easily add or remove servers from the cluster.
- Slide-Deck Ready (URL Params): The app must be embeddable in presentation iframes. It must read URL parameters on load (e.g., ?nodes=5&code=https://raw.githubusercontent.com/.../demo.js) to automatically configure the cluster size and fetch the JS payload.



