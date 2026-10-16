Example card: Fogharbor Bureau. Requires Tavern Helper, enabled card scripts and frontend rendering, and access to the public dependencies listed in project.json.
MVU stores state. The first message uses worldbook initial values; each of the three alternate greetings includes an <initvar> block overriding them. The panel reads the current message's variables only.
MVU adds <StatusPlaceHolderImpl/> while handling a message; the card does not ask the model to output a placeholder.
