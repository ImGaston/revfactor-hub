// Matches every non-intercepted route so soft navigations away from an open
// modal (e.g. deleting a lead pushes /pipeline) clear the slot instead of
// keeping the previous modal rendered.
export default function CatchAll() {
  return null
}
