import React from "react";

const EditEventModal = ({ modalOpen, setModalOpen, form, setForm, handleSave, handleDelete, editingEvent }) => {
  if (!modalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-xl shadow-lg w-96">
        <h2 className="text-xl font-bold mb-4">{editingEvent ? "Edit Event" : "Add Event"}</h2>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border rounded p-2 mt-1"
              required
            />
          </div>

          {/* Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Time</label>
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="w-full border rounded p-2 mt-1"
              required
            />
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Urgency</label>
            <select
              value={form.urgency}
              onChange={(e) => setForm({ ...form, urgency: e.target.value })}
              className="w-full border rounded p-2 mt-1"
            >
              <option value="high">Urgent</option>
              <option value="low">Not Urgent</option>
            </select>
          </div>

          {/* Importance */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Importance</label>
            <select
              value={form.importance}
              onChange={(e) => setForm({ ...form, importance: e.target.value })}
              className="w-full border rounded p-2 mt-1"
            >
              <option value="high">Important</option>
              <option value="low">Not Important</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full border rounded p-2 mt-1"
            >
              <option value="pending">Pending</option>
              <option value="done">Done</option>
              <option value="missed">Missed</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-between mt-4">
            {editingEvent && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition"
              >
                Delete
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-2 bg-gray-300 rounded hover:bg-gray-400 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditEventModal;
