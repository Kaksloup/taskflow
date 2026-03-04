import  { jest }  from '@jest/globals';

global.mockFirestore = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.unstable_mockModule('firebase-admin', () => {
  return {
    default: {
      initializeApp: jest.fn(),
      credential: {
        cert: jest.fn(() => ({})),
      },
      firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn(() =>
            Promise.resolve({
              forEach: (callback) => {
                callback({
                  id: '1',
                  data: () => ({ title: 'Mock Task', completed: false }),
                });
              },
            })
          ),
          doc: jest.fn((id) => {
            const newId = id || `mocked-id-123`;
            let taskData = { title: 'Mock Task', completed: false };
            return {
              id: newId,
              get: jest.fn(() =>
                Promise.resolve({
                  exists: id === '1' || id === '123',
                  id: newId,
                  data: () => (id === '1' || id === '123' ? taskData : null),
                })
              ),
              set: jest.fn(() => Promise.resolve()),
              update: jest.fn((updates) => {
                taskData = { ...taskData, ...updates };
                return Promise.resolve();
              }),
              delete: jest.fn(() => Promise.resolve()),
            };
          }),
        })),
      })),
    }
  };
});
