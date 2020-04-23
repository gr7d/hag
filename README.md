# Hag
**Don't use this project. There are uncountable bugs and I'm building this project only while I create other projects.**

## Example server start
```typescript
import { Hag } from "hag";
import Hello from "./pages/Hello.ts";

const app = new Hag();
app.register("/", Hello);

app.listen(3000);
```

## Pages
### Example page
```typescript
export default class Hello {
    private world: string = "World";

    get template() {
        return `Hello, {{ this.world }}`;
    }
}

// Rendered output would be `Hello, World`
```

### Page exposures
Page exposures are executed client-side.
I don't really like how I'm handling it right now. 
It's getting changed sometime.
```typescript
export default class Hello {
    get exposures() {
        return {
            logClick() {
                console.log("clicked");
            }       
        }
    }   

    get template() {
        return `<button @onclick="logClick">Log click</button>`;
    }
}
```

### Page endpoints
The template is getting rerendered & sent to the automatically.
Endpoint URLs are build like: `[page]/api/[endpoint]`
```typescript
export default class Hello {
    private world: string = "World";

    get endpoints() {
        return {
            GET: {
                changeWorldText() {
                    this.world = "stay home.";
                }   
            }
        }
    }   

    get exposures() {
        return {
            changoMango() {
                fetch("api/changeWorldText");
            }       
        }
    }   

    get template() {
        return `<button @onclick="changoMango">Change the world</button> Hello, {{ this.world }}`;
    }
}
```