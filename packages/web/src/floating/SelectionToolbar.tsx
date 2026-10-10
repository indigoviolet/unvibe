/** Selection toolbar slot (Explain / Ask / Note). Owner: floating agent. */
export function SelectionToolbar() {
  return (
    <div id="selbar" hidden>
      <button type="button" data-act="explain">
        Explain
      </button>
      <span className="sep" />
      <button type="button" data-act="ask">
        Ask…
      </button>
      <button type="button" data-act="note">
        Note
      </button>
    </div>
  );
}
