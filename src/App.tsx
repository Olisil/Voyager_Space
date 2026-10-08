import { Editor } from "./components/Editor";
import { Home } from "./components/Home";
import { useRoute } from "./router";

export default function App() {
  const route = useRoute();
  const m = /^\/p\/([^/]+)/.exec(route);
  return m ? <Editor projectId={decodeURIComponent(m[1])} /> : <Home />;
}
