import { Routes, Route } from "react-router-dom";
import Navbar from "../components/Navbar";
import Home from "../pages/Home";
import Dashboard from "../pages/Dashboard";
import Library from "../pages/Library";
import Reader from "../pages/Reader";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/reader/:id" element={<Reader />} />
      <Route path="/*" element={
        <>
          <Navbar />
          <Routes>
            <Route path="/"          element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/library"   element={<Library />} />
          </Routes>
        </>
      } />
    </Routes>
  );
}