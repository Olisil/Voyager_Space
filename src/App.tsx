import { Editor } from "./components/Editor";
import { Home } from "./components/Home";
import { useRoute } from "./router";

export default function App() {
  const route = useRoute();
  const m = /^\/p\/([^/]+)/.exec(route);
  // keyed, so opening another project (e.g. a duplicate) starts a fresh editor
  return m ? <Editor key={m[1]} projectId={decodeURIComponent(m[1])} /> : <Home />;
}
