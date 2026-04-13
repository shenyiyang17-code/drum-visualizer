import React from "react";

export default function Controls({ pageSec, setPageSec, stepCount, setStepCount, subSecCount, setSubSecCount }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label>每页秒数: <input type="number" value={pageSec} onChange={e => setPageSec(Number(e.target.value))} /></label>
      <label>每小节格数: <input type="number" value={stepCount} onChange={e => setStepCount(Number(e.target.value))} /></label>
      <label>每页小节数: <input type="number" value={subSecCount} onChange={e => setSubSecCount(Number(e.target.value))} /></label>
    </div>
  );
}
