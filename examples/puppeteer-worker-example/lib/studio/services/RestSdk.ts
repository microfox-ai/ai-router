export const RestSdk = {
  getData: (url: string, body: any) => {
    return new Promise<any>(async (resolve, reject) => {
      try {
        const options: any = {
          method: 'GET',
        };
        if (body && Object.keys(body).length > 0)
          options.body = JSON.stringify(body);
        //console.log(url, options);
        const res = await fetch(url, options);
        if (res.ok) {
          const result = await res.json();
          return resolve(result as any);
        } else {
          return reject((await res.json()) as any);
        }
      } catch (e) {
        console.log(e);
        return reject(e as any);
      }
    });
  },
  postData: (url: string, data: any) => {
    return new Promise<any>(async (resolve, reject) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const result = await res.json();
          return resolve(result);
        } else {
          return reject((await res.json()) as any);
        }
      } catch (e) {
        console.log(e);
        return reject(e as any);
      }
    });
  },
  putData: (url: string, data: any) => {
    return new Promise<any>(async (resolve, reject) => {
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
        // console.log(await res.json());
        if (res.ok) {
          const result = await res.json();

          return resolve(result);
        } else if (res.status === 409) {
          const result = await res.json();

          throw result.error;
        } else {
          return reject(res.status as any);
        }
      } catch (e) {
        console.log(e);
        return reject(e as any);
      }
    });
  },
  deleteData: (url: string, data: any) => {
    return new Promise<any>(async (resolve, reject) => {
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
        // console.log(res);
        if (res.ok) {
          const result = await res.json();
          return resolve(result);
        } else {
          return reject(res.status as any);
        }
      } catch (e) {
        console.log(e);
        return reject(e as any);
      }
    });
  },
};
